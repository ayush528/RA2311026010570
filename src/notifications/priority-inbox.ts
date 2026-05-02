import axios from "axios";
import { Log } from "../middleware/logger";

const BASE_URL = "http://20.207.122.201/evaluation-service";

interface Notification {
  ID: string;
  Type: "Placement" | "Result" | "Event";
  Message: string;
  Timestamp: string;
}

interface ScoredNotification extends Notification {
  score: number;
}

// Placement > Result > Event
const TYPE_WEIGHT: Record<string, number> = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

function score(n: Notification): number {
  const typeWeight = TYPE_WEIGHT[n.Type] ?? 0;
  const recencyMs = new Date(n.Timestamp).getTime();
  // Type dominates; within same type, more recent wins
  return typeWeight * 1e13 + recencyMs;
}

/**
 * Min-heap keyed by score — keeps top N notifications in O(M log N) time.
 * Efficient for streaming: push each notification, heap stays size N.
 */
class MinHeap {
  private heap: ScoredNotification[] = [];

  private swap(i: number, j: number) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].score <= this.heap[i].score) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private sinkDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].score < this.heap[smallest].score) smallest = l;
      if (r < n && this.heap[r].score < this.heap[smallest].score) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  push(item: ScoredNotification) {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): ScoredNotification | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): ScoredNotification | undefined {
    return this.heap[0];
  }

  get size(): number {
    return this.heap.length;
  }
}

/**
 * Returns top N notifications ranked by:
 *   1. Type priority  — Placement > Result > Event
 *   2. Recency        — more recent wins within same type
 *
 * Uses a min-heap of size N: O(M log N) time, O(N) space.
 */
export function getTopN(notifications: Notification[], n: number): Notification[] {
  const heap = new MinHeap();

  for (const notif of notifications) {
    const s = score(notif);
    const scored: ScoredNotification = { ...notif, score: s };

    if (heap.size < n) {
      heap.push(scored);
    } else if (heap.peek() && s > heap.peek()!.score) {
      heap.pop();
      heap.push(scored);
    }
  }

  // Extract in descending order (highest score first)
  const result: ScoredNotification[] = [];
  while (heap.size > 0) result.push(heap.pop()!);
  return result.reverse();
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
  await Log("backend", "info", "service", "Priority inbox starting");

  const data = await fetchWithAuth<{ notifications: Notification[] }>("/notifications");
  const all = data.notifications;

  await Log(
    "backend",
    "info",
    "service",
    `Fetched ${all.length} notifications`
  );

  const top10 = getTopN(all, 10);

  console.log("\n========== TOP 10 PRIORITY NOTIFICATIONS ==========\n");
  top10.forEach((n, i) => {
    console.log(`#${i + 1} [${n.Type}] ${n.Message}`);
    console.log(`     ID: ${n.ID}  |  Timestamp: ${n.Timestamp}\n`);
  });

  await Log("backend", "info", "service", "Priority inbox computed");
}

main().catch(async (err) => {
  await Log("backend", "fatal", "service", `Priority inbox error`.slice(0, 48));
  console.error(err);
  process.exit(1);
});
