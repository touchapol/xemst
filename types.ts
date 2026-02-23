export enum AppScreen {
  ACCESS = 'ACCESS',
  METHOD = 'METHOD',
  PROCESSING = 'PROCESSING',
}

export enum AttackMethod {
  WORDLIST = 'WORDLIST',
  BRUTE_FORCE = 'BRUTE_FORCE',
  HYBRID = 'HYBRID'
}

export interface ProcessingLog {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface FileData {
  name: string;
  size: number;
  type: string;
}