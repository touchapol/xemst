#!/usr/bin/env python3
import os
import sys
import time
import json
import uuid
import tempfile
import threading
import subprocess
from pathlib import Path
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import requests

load_dotenv()

load_dotenv()

SCRIPT_DIR = Path(__file__).parent
STEGO_DIR = Path(os.getenv("MP3STEGO_PATH", str(SCRIPT_DIR / "MP3Stego_1_1_19")))
STEGO_CWD = STEGO_DIR / "MP3Stego"
ENCODE_EXE = STEGO_DIR / "Encode.exe"
DECODE_EXE = STEGO_DIR / "Decode.exe"

WORKER_TOKEN = os.getenv("WORKER_TOKEN") or uuid.uuid4().hex
ENDPOINT_DOMAIN = None

app = Flask(__name__)
CORS(app)

commands_store = {}

def get_store(cmd_id):
    if cmd_id not in commands_store:
        commands_store[cmd_id] = {
            "status": "pending",
            "logs": [],
            "result": None,
            "hasResultFile": False,
            "done": False,
            "result_file": None
        }
    return commands_store[cmd_id]

def send_log(cmd_id, msg, log_type="info"):
    store = get_store(cmd_id)
    store["logs"].append({"msg": msg, "type": log_type})
    print(f"[{cmd_id[:8]}] [{log_type}] {msg}")

def mark_done(cmd_id, success, result=None, error=None, result_file=None):
    store = get_store(cmd_id)
    store["status"] = "completed" if success else "failed"
    store["result"] = {"success": success, "result": result, "error": error}
    store["result_file"] = result_file
    store["hasResultFile"] = bool(result_file)
    store["done"] = True

def run_process_stream(cmd, cmd_id, cwd=None):
    try:
        proc = subprocess.Popen(
            cmd, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.STDOUT, 
            cwd=cwd,
            text=True,
            bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        
        import re
        output_lines = []
        has_error = False
        frame_pattern = re.compile(r'^\[Frame\s+(\d+)\]$')
        time_pattern = re.compile(r'^\d{1,2}:\d{2}:\d{2}$')
        
        for line in iter(proc.stdout.readline, ''):
            line_str = line.strip()
            if not line_str:
                continue

            output_lines.append(line_str)
            if '[ERROR]' in line_str or 'Error' in line_str or 'error' in line_str.lower():
                has_error = True
                
            send_it = True
            if line_str == '>':
                send_it = False
            elif time_pattern.match(line_str):
                send_it = False
            else:
                match = frame_pattern.match(line_str)
                if match:
                    try:
                        frame_num = int(match.group(1))
                        if frame_num % 20 != 0:
                            send_it = False
                    except:
                        pass
                        
            if send_it:
                send_log(cmd_id, line_str, "info")
                    
        proc.wait()
        return proc.returncode, "\n".join(output_lines), has_error
    except Exception as e:
        send_log(cmd_id, str(e), "error")
        return -1, str(e), True

def cmd_encode(cmd_id, params, mp3_file_path):
    print(f"🔒 Encoding command {cmd_id[:8]}...")
    try:
        tmpdir = tempfile.mkdtemp()
        text = params.get("text", "")
        secret = params.get("secret", "")
        
        text_file = os.path.join(tmpdir, "message.txt")
        output_file = os.path.join(tmpdir, f"output_{cmd_id}.mp3")

        with open(text_file, "w") as f:
            f.write(text)

        cmd = [str(ENCODE_EXE), "-E", text_file, mp3_file_path, output_file]
        if secret:
            cmd = [str(ENCODE_EXE), "-E", text_file, "-P", secret, mp3_file_path, output_file]

        clean_cmd = [os.path.basename(c) if ('\\' in c or '/' in c) else c for c in cmd]
        
        send_log(cmd_id, f"Running: {' '.join(clean_cmd)}")

        code, output, has_error = run_process_stream(cmd, cmd_id, cwd=str(STEGO_CWD))

        if os.path.exists(output_file) and not has_error:
            send_log(cmd_id, "Encoding successful", "success")
            mark_done(cmd_id, True, result="Encoding successful", result_file=output_file)
            print(f"✅ Encode done: {cmd_id[:8]}")
        else:
            mark_done(cmd_id, False, error="Encoding failed")
    except Exception as e:
        mark_done(cmd_id, False, error=str(e))

def cmd_decode(cmd_id, params, mp3_file_path):
    print(f"🔓 Decoding command {cmd_id[:8]}...")
    try:
        secret = params.get("secret", "")
        output_file = mp3_file_path + ".txt"

        cmd = [str(DECODE_EXE), "-X", mp3_file_path]
        if secret:
            cmd = [str(DECODE_EXE), "-X", "-P", secret, mp3_file_path]

        clean_cmd = [os.path.basename(c) if ('\\' in c or '/' in c) else c for c in cmd]

        send_log(cmd_id, f"Running: {' '.join(clean_cmd)}")
        code, output, has_error = run_process_stream(cmd, cmd_id, cwd=str(STEGO_CWD))

        if os.path.exists(output_file) and not has_error:
            with open(output_file, 'r', errors='ignore') as f:
                decoded_text = f.read()
            send_log(cmd_id, "Decode successful", "success")
            
            text_str = decoded_text.strip()
            if text_str:
                send_log(cmd_id, f"--- HIDDEN MESSAGE ---", "success")
                send_log(cmd_id, text_str, "success")
                send_log(cmd_id, "-" * 22, "success")
                
            mark_done(cmd_id, True, result=json.dumps({'text': text_str}))
            print(f"✅ Decode done: {cmd_id[:8]}")
        else:
            mark_done(cmd_id, False, error="Decoding failed")
    except Exception as e:
        mark_done(cmd_id, False, error=str(e))

import concurrent.futures
import shutil

def cmd_bruteforce(cmd_id, params, mp3_file_path, wordlist_path=None):
    print(f"💣 Brute force command {cmd_id[:8]}...")
    try:
        chunk_size = max(1, min(50, int(params.get("chunk_size", 10))))
        check_gibberish = params.get("check_gibberish", False)
        
        if not wordlist_path:
            wordlist_path = "C:\\wordlists\\rockyou.txt"
            if not os.path.exists(wordlist_path):
                mark_done(cmd_id, False, error="No wordlist provided and rockyou.txt not found")
                return

        with open(wordlist_path, "r", errors="ignore") as wf:
            passwords = [line.strip() for line in wf if line.strip()]

        total = len(passwords)
        send_log(cmd_id, f"Brute forcing {total} passwords (Chunk: {chunk_size}, Gibberish Filter: {check_gibberish})...")

        wdir = os.path.dirname(mp3_file_path)
        tables_src = os.path.join(str(STEGO_CWD), "tables")
        tables_dst = os.path.join(wdir, "tables")
        if os.path.exists(tables_src) and not os.path.exists(tables_dst):
            shutil.copytree(tables_src, tables_dst)

        def try_pwd(pwd, worker_id):
            basename_mp3 = f"w_{worker_id}.mp3"
            worker_mp3 = os.path.join(wdir, basename_mp3)
            
            shutil.copy2(mp3_file_path, worker_mp3)
            
            worker_output = worker_mp3 + ".txt"
            worker_pcm_file = worker_mp3 + ".pcm"
            
            cmd = [str(DECODE_EXE), "-X", "-P", pwd, basename_mp3]
            try:
                result = subprocess.run(cmd, capture_output=True, timeout=120, cwd=wdir, text=True)
                
                if os.path.exists(worker_output):
                    with open(worker_output, "r", errors="replace") as f:
                        decoded = f.read()
                    
                    if decoded.strip():
                        if check_gibberish:
                            valid_chars = sum(1 for c in decoded if (c.isprintable() and ord(c) < 128) or c in '\r\n\t')
                            replacement_chars = decoded.count('\ufffd')
                            pr_ratio = valid_chars / max(1, len(decoded))
                            
                            if pr_ratio < 0.7 or replacement_chars > 3:
                                print(f"[Worker] {pwd}: Gibberish filtered (Ratio: {pr_ratio:.2f}, Replacements: {replacement_chars})")
                                return pwd, False, None, None
                        print(f"[Worker] {pwd}: SUCCESS")
                        return pwd, True, decoded.strip(), worker_output
                    else:
                        print(f"[Worker] {pwd}: Empty file")
                else:
                    if pwd == "p@ssw0rd":
                        print(f"[Worker] {pwd}: Missing file. Out: {result.stdout.strip()} Err: {result.stderr.strip()}")
            except Exception as e:
                print(f"[Worker] Exception on {pwd}: {e}")
                pass
            finally:
                if os.path.exists(worker_mp3): os.remove(worker_mp3)
                if os.path.exists(worker_output): os.remove(worker_output)
                if os.path.exists(worker_pcm_file): os.remove(worker_pcm_file)
            
            return pwd, False, None, None

        found = False
        for i in range(0, total, chunk_size):
            if found: break
            chunk = passwords[i:i+chunk_size]
            with concurrent.futures.ThreadPoolExecutor(max_workers=chunk_size) as executor:
                futures = {executor.submit(try_pwd, pwd, idx): pwd for idx, pwd in enumerate(chunk)}
                for future in concurrent.futures.as_completed(futures):
                    pwd, success, text, worker_path = future.result()
                    if success:
                        send_log(cmd_id, f"{pwd}|||{worker_path}|||{text}", "brute_success")
                        mark_done(cmd_id, True, result=json.dumps({"password": pwd, "text": text}))
                        print(f"✅ Password found: {pwd}")
                        found = True
                    else:
                        if not found:
                            send_log(cmd_id, pwd, "brute_fail")

        if not found:
            mark_done(cmd_id, False, error=f"No password found ({total} tried)")
    except Exception as e:
        mark_done(cmd_id, False, error=str(e))

def verify_token(req):
    token = req.headers.get("Authorization") or req.args.get("token")
    if token and token.startswith("Bearer "):
        token = token.split(" ")[1]
    return token == WORKER_TOKEN

@app.route('/', methods=['GET'])
def index():
    return jsonify({
        "name": "MP3Stego Standalone API",
        "status": "running",
        "tunnel": "active",
        "ready": True
    })

@app.route('/api/health', methods=['GET'])
def health():
    if not verify_token(request):
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"status": "ok", "message": "Worker is ready"})

@app.route('/api/commands', methods=['POST'])
def create_command():
    if not verify_token(request):
        return jsonify({"error": "Unauthorized"}), 401
    
    cmd_type = request.form.get("type", "")
    params = json.loads(request.form.get("params", "{}"))
    
    mp3_file = request.files.get("file")
    wordlist_file = request.files.get("wordlist")
    
    if not mp3_file:
        return jsonify({"error": "No MP3 file uploaded"}), 400
        
    cmd_id = uuid.uuid4().hex
    store = get_store(cmd_id)
    store["status"] = "processing"
    send_log(cmd_id, "Worker picked up command", "info")
    
    tmpdir = tempfile.mkdtemp()
    mp3_path = os.path.join(tmpdir, mp3_file.filename)
    mp3_file.save(mp3_path)
    
    wordlist_path = None
    if wordlist_file:
        wordlist_path = os.path.join(tmpdir, wordlist_file.filename)
        wordlist_file.save(wordlist_path)
        
    if cmd_type == "encode":
        threading.Thread(target=cmd_encode, args=(cmd_id, params, mp3_path), daemon=True).start()
    elif cmd_type == "decode":
        threading.Thread(target=cmd_decode, args=(cmd_id, params, mp3_path), daemon=True).start()
    elif cmd_type == "bruteforce":
        threading.Thread(target=cmd_bruteforce, args=(cmd_id, params, mp3_path, wordlist_path), daemon=True).start()
    else:
        return jsonify({"error": "Invalid command type"}), 400
        
    return jsonify({"commandId": cmd_id})

@app.route('/api/commands/<cmd_id>/stream', methods=['GET'])
def stream_command(cmd_id):
    if not verify_token(request):
        return jsonify({"error": "Unauthorized"}), 401
        
    store = get_store(cmd_id)

    def generate():
        pad = ' ' * (64 * 1024)
        yield f"retry: 3000\n\n"
        yield f"event: connected\ndata: {json.dumps({'commandId': cmd_id})}\n\n"
        
        sent_logs = 0
        done_at = 0
        
        while True:
            wrote = False
            
            if len(store["logs"]) > sent_logs:
                for i in range(sent_logs, len(store["logs"])):
                    log = store["logs"][i]
                    yield f"event: log\ndata: {json.dumps(log)}{pad}\n\n"
                sent_logs = len(store["logs"])
                wrote = True
                
            if store["done"] and not done_at:
                yield f"event: done\ndata: {json.dumps({'status': store['status'], 'result': store['result'], 'hasResultFile': store['hasResultFile']})}{pad}\n\n"
                done_at = time.time()
                wrote = True
                
            if done_at and time.time() - done_at > 10:
                break
                
            if not wrote:
                yield f": hb{pad}\n\n"
                
            time.sleep(0.5)

    res = Response(generate(), mimetype='text/event-stream')
    res.headers['Cache-Control'] = 'no-cache, no-transform'
    res.headers['Connection'] = 'keep-alive'
    res.headers['X-Accel-Buffering'] = 'no'
    return res

@app.route('/uploads/<cmd_id>/<path:filename>', methods=['GET'])
def download_result(cmd_id, filename):
    if not verify_token(request):
        return jsonify({"error": "Unauthorized"}), 401
        
    store = get_store(cmd_id)
    if not store["result_file"] or not os.path.exists(store["result_file"]):
        return jsonify({"error": "File not found"}), 404
        
    dir_name = os.path.dirname(store["result_file"])
    base_name = os.path.basename(store["result_file"])
    return send_from_directory(dir_name, base_name, as_attachment=True, download_name=filename)


CACHE_FILE = os.path.join(SCRIPT_DIR, ".tunnel_cache.json")

def setup_tunnel():
    global ENDPOINT_DOMAIN, WORKER_TOKEN
    
    tunnel_data = None
    private_key = None
    conn_cmd = None
    
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                cache = json.load(f)
            expires_at = cache.get("client", {}).get("expiresAt")
            if expires_at:
                dt_str = expires_at.split(".")[0].replace("Z", "")
                from datetime import datetime
                exp_dt = datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S")
                if datetime.utcnow() < exp_dt:
                    print("♻️  Using cached SSH tunnel...")
                    tunnel_data = cache["client"]
                    private_key = cache["privateKey"]
                    conn_cmd = cache["connectionCommand"]
                    if "workerToken" in cache and not os.getenv("WORKER_TOKEN"):
                        WORKER_TOKEN = cache["workerToken"]
        except Exception as e:
            pass

    if not tunnel_data:
        print("🚀 Requesting temporary SSH tunnel from API...")
        try:
            res = requests.post("https://tunnel-8ilrb42a6el1-lttunnel.cheeph.com/api/temp", timeout=10)
            if res.status_code not in (200, 201):
                print(f"❌ Failed to get tunnel: HTTP {res.status_code} - {res.text}")
                return
                
            data = res.json()
            if not data.get("success"):
                print(f"❌ Tunnel API returned an error: {data}")
                return
                
            tunnel_data = data["data"]["client"]
            private_key = data["data"]["privateKey"]
            conn_cmd = data["data"]["connectionCommand"]
            
            with open(CACHE_FILE, "w") as f:
                cache_data = data["data"]
                cache_data["workerToken"] = WORKER_TOKEN
                json.dump(cache_data, f)
                
        except Exception as e:
            print(f"❌ Setup tunnel error: {e}")
            return
            
    ENDPOINT_DOMAIN = tunnel_data["domain"]
    key_path = os.path.expanduser(f"~/.ssh/{tunnel_data['name']}")
    
    os.makedirs(os.path.expanduser("~/.ssh"), exist_ok=True)
    with open(key_path, "w") as f:
        f.write(private_key)
        
    if os.name != 'nt':
        os.chmod(key_path, 0o600)
        
    print("🌍 Emitting SSH command in background...")
    conn_cmd = conn_cmd.replace("localhost:80", "127.0.0.1:5050")
    conn_cmd = conn_cmd.replace("ssh -R", "ssh -o StrictHostKeyChecking=no -R")
    conn_cmd = conn_cmd.replace(f"~/.ssh/{tunnel_data['name']}", key_path.replace("\\", "/"))
    
    subprocess.Popen(conn_cmd.split(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    print("========================================================")
    print("  ✅ Standalone MP3Stego API Started via Tunnel!")
    print("========================================================")
    print(f"  📌 Endpoint URL:  https://{ENDPOINT_DOMAIN}")
    print(f"  🔑 Worker Token:  {WORKER_TOKEN}")
    print("========================================================")
    print("  ⬆ Copy these into the Web UI to connect.")
    print("========================================================\n")

if __name__ == '__main__':
    setup_tunnel()
    # Run flask on port 5050
    app.run(host='0.0.0.0', port=5050, threaded=True)
