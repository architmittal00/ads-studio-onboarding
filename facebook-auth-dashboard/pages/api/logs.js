import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { getApiLogs, clearApiLogs } from "@/lib/apiLogger";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.method === "DELETE") {
    clearApiLogs();
    return res.status(200).json({ ok: true });
  }

  res.status(200).json({ logs: getApiLogs() });
}
