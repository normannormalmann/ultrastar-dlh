import { spawn } from "node:child_process";

/** DPAPI is shared by the CLI and desktop; no secret appears in process arguments. */
export const protectSecret = (
  value: string,
  decrypt = false,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const operation = decrypt ? "Unprotect" : "Protect";
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, timeout: 10_000 },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 64_000) child.kill();
    });
    child.on("error", () =>
      reject(new Error("Windows credential protection is unavailable")),
    );
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      if (
        code !== 0 ||
        !/^[A-Za-z0-9+/]+=*$/.test(output) ||
        output.length > 64_000
      ) {
        reject(
          new Error(
            "Credentials could not be protected or opened for this Windows account",
          ),
        );
        return;
      }
      resolve(
        decrypt ? Buffer.from(output, "base64").toString("utf8") : output,
      );
    });
    child.stdin.end(
      decrypt ? value : Buffer.from(value, "utf8").toString("base64"),
    );
  });
