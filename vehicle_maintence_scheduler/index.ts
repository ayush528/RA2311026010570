import axios from "axios";
import { Log } from "../logging_middleware/logger";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://20.207.122.201/evaluation-service";

interface Depot {
  ID: number;
  MechanicHours: number;
}

interface Vehicle {
  TaskID: string;
  Duration: number;
  Impact: number;
}

interface DepotSchedule {
  depotID: number;
  mechanicHoursAvailable: number;
  selectedTasks: string[];
  totalDuration: number;
  totalImpact: number;
}

/**
 * 0/1 Knapsack via bottom-up DP.
 * Capacity = mechanic-hours, weight = Duration, value = Impact.
 * O(n * W) time, O(n * W) space.
 */
function knapsack(vehicles: Vehicle[], capacity: number): DepotSchedule {
  const n = vehicles.length;

  // dp[i][w] = max impact using first i vehicles with capacity w
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(capacity + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }

  // Backtrack to recover selected tasks
  const selectedTasks: string[] = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selectedTasks.push(vehicles[i - 1].TaskID);
      w -= vehicles[i - 1].Duration;
    }
  }

  return {
    depotID: -1, // set by caller
    mechanicHoursAvailable: capacity,
    selectedTasks,
    totalDuration: capacity - w,
    totalImpact: dp[n][capacity],
  };
}

async function fetchWithAuth<T>(endpoint: string): Promise<T> {
  const authRes = await axios.post(
    `${BASE_URL}/auth`,
    {
      email: "ak4170@srmist.edu.in",
      name: "ayushmaan krishna",
      rollNo: "ra2311026010570",
      accessCode: "QkbpxH",
      clientID: "076dfd35-bebf-4fb9-8320-0171f0aca240",
      clientSecret: "NnWyYNQFrQtTCPYC",
    },
    { headers: { "Content-Type": "application/json" } }
  );
  const token: string = authRes.data.access_token;
  const res = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

async function main() {
  await Log("backend", "info", "service", "Scheduler starting");

  const [depotsData, vehiclesData] = await Promise.all([
    fetchWithAuth<{ depots: Depot[] }>("/depots"),
    fetchWithAuth<{ vehicles: Vehicle[] }>("/vehicles"),
  ]);

  const depots = depotsData.depots;
  const vehicles = vehiclesData.vehicles;

  await Log(
    "backend",
    "info",
    "service",
    `Fetched ${depots.length} depots, ${vehicles.length} tasks`
  );

  const results: DepotSchedule[] = [];

  for (const depot of depots) {
    const schedule = knapsack(vehicles, depot.MechanicHours);
    schedule.depotID = depot.ID;

    await Log(
      "backend",
      "info",
      "service",
      `Depot ${depot.ID}: impact=${schedule.totalImpact}`
    );

    results.push(schedule);
  }

  const summary = {
    totalDepots: depots.length,
    totalVehicles: vehicles.length,
    schedules: results,
  };

  console.log("\n========== VEHICLE MAINTENANCE SCHEDULE ==========\n");
  console.log(JSON.stringify(summary, null, 2));

  const outDir = path.join(__dirname, "../vehicle_scheduling");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "output.json"),
    JSON.stringify(summary, null, 2)
  );

  // Human-readable summary
  let readable = "VEHICLE MAINTENANCE SCHEDULER – OUTPUT\n";
  readable += "=".repeat(50) + "\n\n";
  readable += `Total Depots : ${depots.length}\n`;
  readable += `Total Vehicles: ${vehicles.length}\n\n`;
  for (const s of results) {
    readable += `Depot ${s.depotID}\n`;
    readable += `  Capacity     : ${s.mechanicHoursAvailable} mechanic-hours\n`;
    readable += `  Used         : ${s.totalDuration} mechanic-hours\n`;
    readable += `  Total Impact : ${s.totalImpact}\n`;
    readable += `  Tasks (${s.selectedTasks.length}):\n`;
    s.selectedTasks.forEach((t) => (readable += `    - ${t}\n`));
    readable += "\n";
  }
  fs.writeFileSync(path.join(outDir, "output.txt"), readable);
  console.log("\n[OUTPUT] Results saved to vehicle_scheduling/output.json and output.txt");

  await Log("backend", "info", "service", "Scheduling complete");
}

main().catch(async (err) => {
  await Log("backend", "fatal", "service", `Scheduler crashed: ${err.message}`.slice(0, 48));
  console.error(err);
  process.exit(1);
});
