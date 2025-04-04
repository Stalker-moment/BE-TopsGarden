// server.js
import express from 'express';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';
import pkg from 'forge-apis';
import fetch from 'node-fetch';
const {
  DerivativesApi,
  JobPayload,
  JobPayloadInput,
  JobPayloadOutput,
  JobSvfOutputPayload,
  BucketsApi,
  PostBucketsPayload
} = pkg;
import { getClient, getInternalToken } from './oauth.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5090;

/**
 * Fungsi untuk membuat bucket jika belum ada menggunakan forge-apis.
 * Bucket key akan diprefix dengan FORGE_CLIENT_ID (dalam huruf kecil).
 * Parameter tokenObj adalah objek token lengkap.
 */
async function createBucketIfNotExist(tokenObj, bucketKey, client) {
  const forgeClientId = process.env.FORGE_CLIENT_ID;
  if (!forgeClientId) {
    throw new Error("FORGE_CLIENT_ID not set in environment.");
  }
  const fullBucketKey = forgeClientId.toLowerCase() + '-' + bucketKey;
  const bucketsApi = new BucketsApi();
  const payload = new PostBucketsPayload();
  payload.bucketKey = fullBucketKey;
  payload.policyKey = 'transient'; // expires in 24h

  try {
    await bucketsApi.createBucket(payload, {}, client, tokenObj);
    console.log(`Bucket ${fullBucketKey} created successfully.`);
  } catch (err) {
    // Jika bucket sudah ada, biasanya mengembalikan status 409
    if (err.statusCode === 409) {
      console.log(`Bucket ${fullBucketKey} already exists.`);
      return;
    }
    console.error("Error creating bucket:", err.response ? err.response.body : err.message);
    throw new Error(`Failed to create bucket: ${err.message}`);
  }
}

// Endpoint untuk mengupload file lokal dan submit translasi job
app.post('/upload', async (req, res) => {
  try {
    // Baca file lokal dari path ./gripper.dwg
    const filePath = './gripper.dwg';
    const fileBuffer = await fs.readFile(filePath);
    const objectName = 'gripper.dwg';

    // Dapatkan token internal (objek lengkap)
    const tokenObj = await getInternalToken();
    console.log('Token:', tokenObj);

    // Dapatkan client dari modul oauth dengan scope internal secara eksplisit
    const client = getClient(['bucket:create', 'bucket:read', 'data:read', 'data:create', 'data:write']);

    // Tentukan bucket key dasar (tanpa prefix)
    const bucketKeyBase = 'myforgebucket';
    // Buat bucket jika belum ada
    await createBucketIfNotExist(tokenObj, bucketKeyBase, client);

    // Gunakan bucket key lengkap dengan prefix
    const fullBucketKey = process.env.FORGE_CLIENT_ID.toLowerCase() + '-' + bucketKeyBase;

    // Gunakan endpoint OSS v2 baru dengan method POST
    const uploadUrl = `https://developer.api.autodesk.com/oss/v2/buckets/${fullBucketKey}/objects?objectName=${encodeURIComponent(objectName)}&overwrite=true`;
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenObj.access_token}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": fileBuffer.length.toString()
      },
      body: fileBuffer
    });
    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      throw new Error(`Upload failed: ${text}`);
    }
    const uploadData = await uploadResponse.json();
    console.log('Upload response:', uploadData);

    // Ambil objectId dan buat URN (dengan base64 encoding)
    const objectId = uploadData.objectId;
    const urn = Buffer.from(objectId).toString('base64');

    // Buat payload translasi untuk format SVF (2D/3D)
    let job = new JobPayload();
    job.input = new JobPayloadInput();
    job.input.urn = urn;
    job.output = new JobPayloadOutput([ new JobSvfOutputPayload() ]);
    job.output.formats[0].type = 'svf';
    job.output.formats[0].views = ['2d', '3d'];

    // Ajukan translasi job menggunakan DerivativesApi
    const derivativesApi = new DerivativesApi();
    await derivativesApi.translate(job, {}, client, tokenObj);

    // Kembalikan URN dan detail job ke client
    res.status(200).json({ urn, job });
  } catch (error) {
    console.error("Error processing upload:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});