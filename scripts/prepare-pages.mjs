import { copyFile } from 'node:fs/promises'

// Keep the existing Firestore invoices at the established public URL.
await copyFile('index.html', 'dist/index.html')
