import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateAgentToken(): { token: string; prefix: string; hash: string } {
  const token = `vag_${randomBytes(24).toString("base64url")}`;
  return {
    token,
    prefix: token.slice(0, 12),
    hash: hashToken(token),
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function isPrivateOrMetadataUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return true;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "metadata.google.internal" ||
      host.endsWith(".local") ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}
