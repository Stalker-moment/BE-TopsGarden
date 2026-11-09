/**
 * ALIN (Aljabar Linier) - NILM Non-Negative Matrix Factorization (NMF) Engine
 * Khusus untuk Disagregasi Beban Kamar Kos (Zero External Dependencies)
 */

export const KOS_APPLIANCES = [
    {
        id: 'kipas_angin',
        name: 'Kipas Angin',
        category: 'Motor Induktif AC',
        usagePattern: 'Sangat Sering (Siang & Malam)',
        nominalWatt: 42.0,
        nominalVA: 44.0,
        nominalVAR: 13.0,
        expectedPf: 0.95,
        color: '#06b6d4'
    },
    {
        id: 'charger_laptop',
        name: 'Charger Laptop',
        category: 'SMPS Switched-Mode',
        usagePattern: 'Jam Produktif / Belajar',
        nominalWatt: 52.0,
        nominalVA: 56.5,
        nominalVAR: 22.0,
        expectedPf: 0.92,
        color: '#6366f1'
    },
    {
        id: 'charger_hp',
        name: 'Charger HP',
        category: 'USB-PD Fast Charge',
        usagePattern: 'Intermiten Pulsa',
        nominalWatt: 22.0,
        nominalVA: 24.0,
        nominalVAR: 9.5,
        expectedPf: 0.91,
        color: '#f59e0b'
    },
    {
        id: 'pompa_galon_standby',
        name: 'Charger Pompa Galon & Standby',
        category: 'Beban Parasitik / Siaga',
        usagePattern: 'Kontinu 24 Jam',
        nominalWatt: 3.5,
        nominalVA: 9.5,
        nominalVAR: 8.8,
        expectedPf: 0.37,
        color: '#10b981'
    },
    {
        id: 'setrika',
        name: 'Setrika Listrik',
        category: 'Pemanas Resistif Murni',
        usagePattern: 'Sangat Jarang (Idle)',
        nominalWatt: 350.0,
        nominalVA: 350.0,
        nominalVAR: 2.0,
        expectedPf: 1.0,
        color: '#ef4444'
    }
];

// Operasi Matriks Ringan (Pure JavaScript)
function zeros(r, c) {
    const m = new Array(r);
    for (let i = 0; i < r; i++) m[i] = new Float64Array(c);
    return m;
}

function matMul(A, B) {
    const rA = A.length, cA = A[0].length, cB = B[0].length;
    const C = zeros(rA, cB);
    for (let i = 0; i < rA; i++) {
        for (let k = 0; k < cA; k++) {
            const a_ik = A[i][k];
            if (a_ik === 0) continue;
            for (let j = 0; j < cB; j++) {
                C[i][j] += a_ik * B[k][j];
            }
        }
    }
    return C;
}

function matTranspose(A) {
    const r = A.length, c = A[0].length;
    const T = zeros(c, r);
    for (let i = 0; i < r; i++) {
        for (let j = 0; j < c; j++) {
            T[j][i] = A[i][j];
        }
    }
    return T;
}

/**
 * Menjalankan NMF dengan Multiplicative Update Rules Lee & Seung (2001)
 * V (N x M) ≈ W (N x K) * H (K x M)
 */
export function solveNMF(V, K = 5, maxIter = 80) {
    const N = V.length;
    const M = V[0].length; // 3 fitur: [P, S, Q]
    const eps = 1e-9;

    // Matriks H diinisialisasi berdasarkan spesifikasi fisik beban
    const H = zeros(K, M);
    for (let k = 0; k < K; k++) {
        H[k][0] = KOS_APPLIANCES[k].nominalWatt;
        H[k][1] = KOS_APPLIANCES[k].nominalVA;
        H[k][2] = KOS_APPLIANCES[k].nominalVAR;
    }

    // Matriks W diinisialisasi dengan proyeksi prior fisika
    const W = zeros(N, K);
    for (let i = 0; i < N; i++) {
        const p = V[i][0];
        W[i][3] = Math.min(1.0, Math.max(0.2, p / 3.5)); // standby
        if (p >= 35) W[i][0] = Math.min(1.0, (p - 3.5) / 42.0); // kipas
        if (p >= 70) W[i][1] = Math.min(1.0, (p - 45.0) / 52.0); // laptop
        if (p >= 105) W[i][2] = Math.min(1.0, (p - 95.0) / 22.0); // charger HP
        W[i][4] = p >= 280 ? (p / 350.0) : 0.000001; // setrika
    }

    // Pembaruan iteratif Lee & Seung
    for (let iter = 0; iter < maxIter; iter++) {
        // 1. Update W: W = W .* (V * H^T) ./ (W * H * H^T + eps)
        const HT = matTranspose(H);
        const V_HT = matMul(V, HT);
        const WH = matMul(W, H);
        const WH_HT = matMul(WH, HT);

        for (let r = 0; r < N; r++) {
            for (let c = 0; c < K; c++) {
                W[r][c] = W[r][c] * (V_HT[r][c] / (WH_HT[r][c] + eps));
            }
        }

        // 2. Update H: H = H .* (W^T * V) ./ (W^T * W * H + eps)
        const WT = matTranspose(W);
        const WT_V = matMul(WT, V);
        const WT_W = matMul(WT, W);
        const WT_W_H = matMul(WT_W, H);

        for (let r = 0; r < K; r++) {
            for (let c = 0; c < M; c++) {
                if (r === 4) {
                    // Setrika tetap dikunci pada tanda tangan resistif nominal jika tidak pernah aktif
                    H[r][c] = KOS_APPLIANCES[r].nominalWatt;
                } else {
                    H[r][c] = Math.max(eps, H[r][c] * (WT_V[r][c] / (WT_W_H[r][c] + eps)));
                }
            }
        }
    }

    return { W, H };
}

/**
 * Memproses Time-Series Data dan Menghasilkan Disagregasi Beban Kos
 */
export function disaggregateTimeSeries(series, stepDurationHours = 1 / 60) {
    if (!series || series.length === 0) {
        return {
            metadata: { count: 0, totalKwh: 0 },
            applianceBreakdown: [],
            disaggregatedPoints: []
        };
    }

    const N = series.length;
    const K = KOS_APPLIANCES.length;

    // Siapkan matriks V [P, S, Q]
    const V = zeros(N, 3);
    let totalMeasuredKwh = 0;

    for (let i = 0; i < N; i++) {
        const item = series[i];
        const p = Math.max(0.001, item.avgPower || item.power || 0);
        const v = Math.max(100, item.avgVoltage || item.voltage || 220);
        const a = Math.max(0.001, item.avgCurrent || item.current || (p / v));
        const s = +(v * a).toFixed(2);
        const q = +(Math.sqrt(Math.max(0, s * s - p * p))).toFixed(2);

        V[i][0] = p;
        V[i][1] = s;
        V[i][2] = q;

        totalMeasuredKwh += (item.usageKwh || (p / 1000 * stepDurationHours));
    }

    const { W, H } = solveNMF(V, K, 60);

    const applianceTotals = KOS_APPLIANCES.map((app, idx) => ({
        id: app.id,
        name: app.name,
        category: app.category,
        usagePattern: app.usagePattern,
        color: app.color,
        signatureP: +H[idx][0].toFixed(1),
        signatureS: +H[idx][1].toFixed(1),
        signatureQ: +H[idx][2].toFixed(1),
        totalKwh: 0,
        percentage: 0,
        peakWatt: 0,
        activeCount: 0
    }));

    const disaggregatedPoints = [];

    for (let i = 0; i < N; i++) {
        const item = series[i];
        const actualP = V[i][0];

        let sumEst = 0;
        const rawPowers = new Float64Array(K);
        for (let k = 0; k < K; k++) {
            rawPowers[k] = W[i][k] * H[k][0];
            sumEst += rawPowers[k];
        }

        const pointPowers = {};
        const factor = sumEst > 0 ? (actualP / sumEst) : 1.0;

        for (let k = 0; k < K; k++) {
            const finalWatt = +(rawPowers[k] * factor).toFixed(2);
            const kwh = (finalWatt / 1000) * stepDurationHours;
            
            pointPowers[KOS_APPLIANCES[k].id] = finalWatt;
            applianceTotals[k].totalKwh += kwh;
            if (finalWatt > applianceTotals[k].peakWatt) {
                applianceTotals[k].peakWatt = finalWatt;
            }
            if (finalWatt >= 3.0) {
                applianceTotals[k].activeCount++;
            }
        }

        disaggregatedPoints.push({
            label: item.label || item.time || `${i}`,
            timestamp: item.timestamp || item.createdAt || null,
            actualPower: actualP,
            actualVoltage: +(V[i][1] / Math.max(0.01, item.avgCurrent || item.current || 1)).toFixed(1),
            actualCurrent: +(item.avgCurrent || item.current || 0).toFixed(2),
            apparentPower: V[i][1],
            reactivePower: V[i][2],
            pf: +(Math.min(1.0, actualP / Math.max(0.1, V[i][1]))).toFixed(2),
            usageKwh: +(actualP / 1000 * stepDurationHours).toFixed(5),
            powers: pointPowers
        });
    }

    const totalReconKwh = applianceTotals.reduce((s, a) => s + a.totalKwh, 0);
    applianceTotals.forEach(app => {
        app.totalKwh = +app.totalKwh.toFixed(4);
        app.percentage = totalReconKwh > 0 ? +((app.totalKwh / totalReconKwh) * 100).toFixed(2) : 0;
    });

    const PLN_RATE = 1444.70;

    return {
        metadata: {
            totalPoints: N,
            stepDurationHours,
            totalEnergyKwh: +totalReconKwh.toFixed(4),
            totalEnergyMeasuredKwh: +totalMeasuredKwh.toFixed(4),
            estimatedCostIdr: Math.round(totalReconKwh * PLN_RATE),
            reconstructionAccuracyPct: +(100 - Math.min(100, Math.abs(totalMeasuredKwh - totalReconKwh) / (totalMeasuredKwh || 1) * 100)).toFixed(2)
        },
        applianceBreakdown: applianceTotals,
        points: disaggregatedPoints
    };
}

/**
 * Analisis Beban Realtime Seketika untuk Telemetri Langsung Kos
 */
export function analyzeRealtimeLoad(latestLog) {
    if (!latestLog) {
        return {
            status: 'OFFLINE',
            telemetry: null,
            activeAppliances: []
        };
    }

    const p = Number(latestLog.power) || 0;
    const v = Number(latestLog.voltage) || 0;
    const a = Number(latestLog.current) || 0;
    const pf = Number(latestLog.pf) || 0;
    const f = Number(latestLog.frequency) || 50.0;
    const apparent = +(v * a).toFixed(1);
    const reactive = +(Math.sqrt(Math.max(0, apparent * apparent - p * p))).toFixed(1);

    // Evaluasi status seketika masing-masing beban kos
    const states = [];

    // 1. Standby & Pompa Galon (selalu aktif sebagai baseline)
    const standbyWatt = Math.min(p, 3.8);
    states.push({
        id: 'pompa_galon_standby',
        name: 'Pompa Galon & Standby',
        estimatedWatt: standbyWatt,
        isActive: true,
        confidence: 0.98,
        color: '#10b981'
    });

    // 2. Kipas Angin (aktif jika beban stabil di atas ~35W)
    let fanWatt = 0;
    let fanActive = false;
    if (p >= 35) {
        fanActive = true;
        fanWatt = Math.min(46, Math.max(0, p - standbyWatt));
    }
    states.push({
        id: 'kipas_angin',
        name: 'Kipas Angin',
        estimatedWatt: fanWatt,
        isActive: fanActive,
        confidence: fanActive ? 0.94 : 0.05,
        color: '#06b6d4'
    });

    // 3. Charger Laptop (aktif jika beban melebihi daya kipas + standby)
    let laptopWatt = 0;
    let laptopActive = false;
    if (p >= 70) {
        laptopActive = true;
        laptopWatt = Math.min(65, Math.max(0, p - standbyWatt - fanWatt));
    }
    states.push({
        id: 'charger_laptop',
        name: 'Charger Laptop',
        estimatedWatt: laptopWatt,
        isActive: laptopActive,
        confidence: laptopActive ? 0.91 : 0.05,
        color: '#6366f1'
    });

    // 4. Charger HP (pulsa intermiten pada beban > 105W)
    let hpWatt = 0;
    let hpActive = false;
    if (p >= 105) {
        hpActive = true;
        hpWatt = Math.min(30, Math.max(0, p - standbyWatt - fanWatt - laptopWatt));
    }
    states.push({
        id: 'charger_hp',
        name: 'Charger HP',
        estimatedWatt: hpWatt,
        isActive: hpActive,
        confidence: hpActive ? 0.88 : 0.05,
        color: '#f59e0b'
    });

    // 5. Setrika (beban resistif murni > 280W)
    let ironWatt = 0;
    let ironActive = false;
    if (p >= 280) {
        ironActive = true;
        ironWatt = p;
    }
    states.push({
        id: 'setrika',
        name: 'Setrika Listrik',
        estimatedWatt: ironWatt,
        isActive: ironActive,
        confidence: ironActive ? 0.99 : 0.01,
        color: '#ef4444'
    });

    return {
        status: 'ONLINE',
        timestamp: latestLog.createdAt || new Date().toISOString(),
        telemetry: {
            powerWatt: p,
            voltageVolt: v,
            currentAmpere: a,
            powerFactor: pf,
            frequencyHz: f,
            apparentPowerVA: apparent,
            reactivePowerVAR: reactive
        },
        estimatedAppliances: states
    };
}

