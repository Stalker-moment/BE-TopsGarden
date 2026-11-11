export class HistoryInputError extends Error {
    status = 400;
}
export const wibDate = (now = new Date()) => new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
export function wibParts(timestamp) {
    const date = new Date(new Date(timestamp).getTime() + 7 * 3600000);
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}
export function wibWindow(date, hour, minute) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
        throw new HistoryInputError("Tanggal harus berupa YYYY-MM-DD yang valid");
    for (const [value, max, label] of [[hour, 23, "Jam"], [minute, 59, "Menit"]]) {
        if (value !== undefined && (!/^\d{1,2}$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > max))
            throw new HistoryInputError(`${label} tidak valid`);
    }
    if (minute !== undefined && hour === undefined) throw new HistoryInputError("Menit memerlukan jam");
    const start = new Date(`${date}T${String(hour ?? 0).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}:00+07:00`);
    const duration = minute !== undefined ? 60000 : hour !== undefined ? 3600000 : 86400000;
    return { start, end: new Date(start.getTime() + duration - 1) };
}
export function logQuery(query, id) {
    const where = id === "all" ? {} : { deviceId: id };
    const hour = query.hour === "all" || query.hour === "" ? undefined : query.hour;
    const minute = query.minute === "all" || query.minute === "" ? undefined : query.minute;
    if ((hour !== undefined || minute !== undefined) && !query.date) throw new HistoryInputError("Filter jam/menit memerlukan tanggal");
    const bounds = query.date ? wibWindow(query.date, hour, minute) : {};
    const parse = (value) => {
        if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value)))
            throw new HistoryInputError("Timestamp harus ISO 8601 dengan zona waktu");
        return new Date(value);
    };
    const start = query.startDate !== undefined ? parse(query.startDate) : bounds.start;
    const end = query.endDate !== undefined ? parse(query.endDate) : bounds.end;
    if (start && end && start > end) throw new HistoryInputError("Awal rentang harus sebelum akhir rentang");
    if (start || end) where.createdAt = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
    const limit = query.limit === undefined ? (where.createdAt ? 1000 : 20) : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new HistoryInputError("Limit harus 1 sampai 10000");
    if (query.order !== undefined && !["asc", "desc"].includes(query.order)) throw new HistoryInputError("Urutan tidak valid");
    return { where, orderBy: { createdAt: query.order || (where.createdAt ? "asc" : "desc") }, take: limit };
}
export function addCurrent(bucket, value) {
    if (value == null || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 120) return;
    bucket._currentSum = (bucket._currentSum || 0) + Number(value);
    bucket._currentCount = (bucket._currentCount || 0) + 1;
}
export function averageCurrent(bucket) {
    return bucket._currentCount ? Number((bucket._currentSum / bucket._currentCount).toFixed(3)) : null;
}
