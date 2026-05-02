import express, { Request, Response } from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const BASE_URL = "http://20.207.122.201/evaluation-service";
const PORT = 3000;

const CREDENTIALS = {
  email: "ak4170@srmist.edu.in",
  name: "ayushmaan krishna",
  rollNo: "ra2311026010570",
  accessCode: "QkbpxH",
  clientID: "076dfd35-bebf-4fb9-8320-0171f0aca240",
  clientSecret: "NnWyYNQFrQtTCPYC",
};

// cached token
let cachedToken = "";
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiry - nowSec > 60) return cachedToken;
  const res = await axios.post(`${BASE_URL}/auth`, CREDENTIALS, {
    headers: { "Content-Type": "application/json" },
  });
  cachedToken = res.data.access_token;
  tokenExpiry = res.data.expires_in;
  return cachedToken;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ---------- knapsack helpers ----------
interface Vehicle { TaskID: string; Duration: number; Impact: number }
interface Depot   { ID: number; MechanicHours: number }

function knapsack(vehicles: Vehicle[], capacity: number) {
  const n = vehicles.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
    }
  }
  const selected: string[] = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) { selected.push(vehicles[i - 1].TaskID); w -= vehicles[i - 1].Duration; }
  }
  return { selectedTasks: selected, totalDuration: capacity - w, totalImpact: dp[n][capacity] };
}

// ---------- priority inbox helpers ----------
interface Notification { ID: string; Type: string; Message: string; Timestamp: string }
const TYPE_WEIGHT: Record<string, number> = { Placement: 3, Result: 2, Event: 1 };

function score(n: Notification) {
  return (TYPE_WEIGHT[n.Type] ?? 0) * 1e13 + new Date(n.Timestamp).getTime();
}

function topN(notifications: Notification[], n: number) {
  return [...notifications]
    .map(n => ({ ...n, score: score(n) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// ============================================================
// ROUTES
// ============================================================

// Health
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "Afford backend server running" });
});

// Auth – get a fresh token
app.post("/api/auth", async (_req: Request, res: Response) => {
  try {
    const result = await axios.post(`${BASE_URL}/auth`, CREDENTIALS, {
      headers: { "Content-Type": "application/json" },
    });
    res.json(result.data);
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data ?? err.message });
  }
});

// Depots
app.get("/api/depots", async (_req: Request, res: Response) => {
  try {
    const token = await getToken();
    const result = await axios.get(`${BASE_URL}/depots`, { headers: authHeader(token) });
    res.json(result.data);
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data ?? err.message });
  }
});

// Vehicles
app.get("/api/vehicles", async (_req: Request, res: Response) => {
  try {
    const token = await getToken();
    const result = await axios.get(`${BASE_URL}/vehicles`, { headers: authHeader(token) });
    res.json(result.data);
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data ?? err.message });
  }
});

// Vehicle schedule – runs knapsack across all depots
app.get("/api/schedule", async (_req: Request, res: Response) => {
  try {
    const token = await getToken();
    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`,   { headers: authHeader(token) }),
      axios.get(`${BASE_URL}/vehicles`, { headers: authHeader(token) }),
    ]);
    const depots: Depot[]     = depotsRes.data.depots;
    const vehicles: Vehicle[] = vehiclesRes.data.vehicles;

    const schedules = depots.map(depot => ({
      depotID: depot.ID,
      mechanicHoursAvailable: depot.MechanicHours,
      ...knapsack(vehicles, depot.MechanicHours),
    }));

    res.json({ totalDepots: depots.length, totalVehicles: vehicles.length, schedules });
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data ?? err.message });
  }
});

// Notifications – raw list from eval service
app.get("/api/notifications", async (_req: Request, res: Response) => {
  try {
    const token = await getToken();
    const result = await axios.get(`${BASE_URL}/notifications`, { headers: authHeader(token) });
    res.json(result.data);
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data ?? err.message });
  }
});

// Priority inbox – top N notifications (default 10)
app.get("/api/notifications/top", async (req: Request, res: Response) => {
  try {
    const n = parseInt(req.query.n as string) || 10;
    const token = await getToken();
    const result = await axios.get(`${BASE_URL}/notifications`, { headers: authHeader(token) });
    const notifications: Notification[] = result.data.notifications ?? result.data;
    res.json({ top: topN(notifications, n) });
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data ?? err.message });
  }
});

// Logs – forward a log entry
app.post("/api/logs", async (req: Request, res: Response) => {
  try {
    const token = await getToken();
    const result = await axios.post(`${BASE_URL}/logs`, req.body, { headers: authHeader(token) });
    res.json(result.data);
  } catch (err: any) {
    res.status(502).json({ error: err?.response?.data ?? err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Afford backend server → http://localhost:${PORT}\n`);
  console.log("  Routes:");
  console.log("    GET  /                       health check");
  console.log("    POST /api/auth               get bearer token");
  console.log("    GET  /api/depots             list depots");
  console.log("    GET  /api/vehicles           list vehicle tasks");
  console.log("    GET  /api/schedule           run knapsack scheduler");
  console.log("    GET  /api/notifications      raw notification feed");
  console.log("    GET  /api/notifications/top  top-N priority inbox (?n=10)");
  console.log("    POST /api/logs               post a log entry\n");
});
