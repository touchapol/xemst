const pin = process.argv[2];

if (!pin || pin.length !== 8) {
    console.log("❌ กรุณาระบุรหัส PIN ตัวเลข 8 หลัก เช่น:");
    console.log("   bun generate_pin.ts 12345678");
    process.exit(1);
}

const hasher = new Bun.CryptoHasher("sha256");
hasher.update(pin);
const hash = hasher.digest("hex");

console.log(`\n✅ รหัส PIN: ${pin}`);
console.log(`🔑 รหัส Hash: ${hash}\n`);
console.log(`👉 นำข้อความด้านล่างนี้ไปใส่ในไฟล์ /stegcracker-online/.env.local (ถ้าไม่มีให้สร้างใหม่)`);
console.log(`--------------------------------------------------`);
console.log(`VITE_PIN_HASH=${hash}`);
console.log(`--------------------------------------------------\n`);
