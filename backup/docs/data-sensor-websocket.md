# Data Sensor Streaming Guide

Dokumen ini merangkum dua jalur akses data sensor:

1. WebSocket `/dataSensor` untuk data realtime.
2. REST API `GET /api/sensor/history` untuk data historis sesuai rentang tanggal.

## Ikhtisar
- **Realtime**: `ws://<host>:<port>/dataSensor?token=<JWT>`
- **History API**: `GET https://<host>/api/sensor/history`
- **Autentikasi**:
  - WebSocket: query `token=<JWT>`.
  - REST API: header `Authorization: Bearer <JWT>`.
- **Enkripsi WebSocket**: payload terenkripsi AES-256-CBC memakai `WS_SECRET_KEY`. API history merespons JSON biasa.

## Variabel Lingkungan Penting
| Nama | Deskripsi | Default |
| --- | --- | --- |
| `SENSOR_PUSH_INTERVAL_MS` | Interval push realtime | `2000` |
| `SENSOR_RECENT_LIMIT` | Jumlah data sejarah singkat pada payload realtime | `10` |
| `SENSOR_HISTORY_DEFAULT_LIMIT` | Limit default history ketika tidak ditentukan | `288` |
| `SENSOR_HISTORY_MAX_LIMIT` | Limit maksimum data history per permintaan | `2000` |
| `SENSOR_HISTORY_MAX_RANGE_DAYS` | Rentang hari maksimum untuk query history | `30` |
| `WS_SECRET_KEY` | Kunci enkripsi WebSocket | — |
| `JWT_SECRET` | Secret untuk menandatangani token | — |

## WebSocket Realtime `/dataSensor`
1. Buka koneksi dengan token valid: `new WebSocket("ws://localhost:1777/dataSensor?token=<JWT>")`.
2. Server mengirim snapshot awal begitu koneksi sukses.
3. Setiap perubahan data sensor memicu payload baru:
   ```jsonc
   {
     "latest": {
       "voltage": 11.9,
       "ph": 6.7,
       "temperature": 27.4,
       "humidity": 63.1,
       "ldr": true,
       "updatedAt": "14:22:31"
     },
     "history": {
       "temperature": {
         "value": [27.2, 27.3, 27.4],
         "timestamp": ["14:20:30", "14:21:30", "14:22:30"]
       }
     }
   }
   ```
4. Payload dikirim dalam kemasan terenkripsi `{ iv, content }`. Klien harus mendekripsi memakai `WS_SECRET_KEY`.

> `latest.updatedAt` memakai format lokal `HH:mm:ss` untuk kemudahan tampilan dashboard.

### Contoh Klien Realtime
```javascript
import { decryptPayload } from "./crypto.js";

const ws = new WebSocket("ws://localhost:1777/dataSensor?token=<JWT>");
ws.onmessage = (event) => {
  const decrypted = decryptPayload(JSON.parse(event.data));
  renderRealtime(decrypted.latest, decrypted.history);
};
```

## REST API History `/api/sensor/history`
- **Method**: `GET`
- **Header**: `Authorization: Bearer <JWT>`
- **Query Parameters**:

| Nama | Contoh | Wajib | Keterangan |
| --- | --- | --- | --- |
| `startDate` | `2025-04-05T00:00:00Z` | Ya* | Gunakan bersama `endDate`. ISO 8601. |
| `endDate` | `2025-04-05T23:59:59Z` | Ya* | Harus >= `startDate`. |
| `date` | `2025-04-05` | Alternatif | Jika diisi, server otomatis mengambil satu hari penuh dan `startDate/endDate` boleh dikosongkan. |
| `limit` | `500` | Opsional | Positive integer, dibatasi `SENSOR_HISTORY_MAX_LIMIT`. |

`startDate`/`endDate` wajib kecuali Anda memakai `date` tunggal.

### Contoh Permintaan
```bash
curl -X GET "https://localhost:1777/api/sensor/history?startDate=2025-04-05T00:00:00Z&endDate=2025-04-05T23:59:59Z&limit=500" \
  -H "Authorization: Bearer <JWT>"
```

### Respons Berhasil
```json
{
  "message": "Sensor history fetched",
  "range": {
    "start": "2025-04-05T00:00:00.000Z",
    "end": "2025-04-05T23:59:59.999Z"
  },
  "limit": 500,
  "total": 480,
  "data": {
    "temperature": {
      "value": [26.9, 27.4, 28.1],
      "timestamp": [
        "12:00:05",
        "12:05:05",
        "12:10:05"
      ]
    },
    "humidity": { "value": [...], "timestamp": [...] },
    "voltage": { "value": [...], "timestamp": [...] },
    "ph": { "value": [...], "timestamp": [...] },
    "ldr": { "value": [...], "timestamp": [...] }
  },
  "latest": {
    "voltage": 12.0,
    "ph": 6.5,
    "temperature": 28.1,
    "humidity": 62.3,
    "ldr": false,
    "updatedAt": "23:59:20"
  }
}
```

> Mulai sekarang `data.*.timestamp` berisi string jam lokal `HH:mm:ss` sehingga langsung siap pakai untuk visualisasi detik.

### JavaScript Fetch Sample
```javascript
async function fetchHistory({ startDate, endDate, limit, token }) {
  const params = new URLSearchParams({ startDate, endDate });
  if (limit) params.append("limit", String(limit));
  const res = await fetch(`/api/sensor/history?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

## Troubleshooting
- **`Token is required`**: tambahkan query token di WebSocket atau header Bearer pada API.
- **`Invalid or expired token`**: JWT sudah kedaluwarsa/tidak valid.
- **`Rentang maksimal X hari`**: perkecil jarak tanggal.
- **`limit harus berupa angka positif`**: masukkan bilangan bulat > 0.
- **Payload WebSocket tidak bisa didekripsi**: pastikan `WS_SECRET_KEY` sama dan gunakan IV serta ciphertext sesuai respons.

---
Referensi kode utama:
- [sockets/dataSensor.js](../sockets/dataSensor.js)
- [controllers/sensor/history.js](../controllers/sensor/history.js)
- [functions/sendSensor.js](../functions/sendSensor.js)
- [helper/encyptJson.js](../helper/encyptJson.js)
