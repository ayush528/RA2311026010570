import axios from "axios";

const BASE_URL = "http://20.207.122.201/evaluation-service";
const LOG_API = `${BASE_URL}/logs`;
const AUTH_API = `${BASE_URL}/auth`;

const CREDENTIALS = {
  email: "ak4170@srmist.edu.in",
  name: "ayushmaan krishna",
  rollNo: "ra2311026010570",
  accessCode: "QkbpxH",
  clientID: "076dfd35-bebf-4fb9-8320-0171f0aca240",
  clientSecret: "NnWyYNQFrQtTCPYC",
};

let cachedToken = "";
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiry - nowSec > 60) return cachedToken;

  const res = await axios.post(AUTH_API, CREDENTIALS, {
    headers: { "Content-Type": "application/json" },
  });
  cachedToken = res.data.access_token;
  tokenExpiry = res.data.expires_in;
  return cachedToken;
}

export type Stack = "backend" | "frontend";
export type Level = "debug" | "info" | "warn" | "error" | "fatal";
export type Package =
  | "cache"
  | "controller"
  | "cron_job"
  | "db"
  | "domain"
  | "handler"
  | "repository"
  | "route"
  | "service"
  | "api"
  | "component"
  | "hook"
  | "page"
  | "state"
  | "style"
  | "auth"
  | "config"
  | "middleware"
  | "utils";

export async function Log(
  stack: Stack,
  level: Level,
  pkg: Package,
  message: string
): Promise<void> {
  try {
    const token = await getToken();
    const response = await axios.post(
      LOG_API,
      { stack, level, package: pkg, message },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(
      `[LOG] ${stack}/${pkg}/${level}: "${message}" → logID: ${response.data.logID}`
    );
  } catch (err: any) {
    console.error("[LOG ERROR]", err?.response?.data ?? err?.message ?? err);
  }
}
