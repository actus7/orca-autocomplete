// An Orca started with its own data folder (`--user-data-dir`, a portable install, a second profile)
// keeps its data there, not in the usual place. The worker is started by that Orca, so the folder is
// on the command line of one of the processes above it.
import { execFile } from 'node:child_process'

const MAX_LEVELS = 4
const RUN_TIMEOUT_MS = 5000

/** The folder given as `--user-data-dir=...` or `--user-data-dir ...` on a command line, if any. */
export function parseUserDataDir(commandLine: string): string | null {
  const match = /--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(commandLine)
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null
}

export type ProcessInfo = { commandLine: string; parent: number | null }
export type ProcessLookup = (pid: number) => Promise<ProcessInfo | null>

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: RUN_TIMEOUT_MS, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout))
  })
}

/** Command line and parent of a process, by the platform's own tools. */
const lookupProcess: ProcessLookup = async (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }
  if (process.platform === 'win32') {
    const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { @{ CommandLine = $p.CommandLine; Parent = $p.ParentProcessId } | ConvertTo-Json -Compress }`
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    try {
      const parsed = JSON.parse(output ?? '') as { CommandLine?: string; Parent?: number }
      return { commandLine: parsed.CommandLine ?? '', parent: parsed.Parent ?? null }
    } catch {
      return null
    }
  }
  const output = await run('ps', ['-o', 'ppid=,args=', '-p', String(pid)])
  const line = output?.trim()
  const split = line ? /^(\d+)\s+(.*)$/s.exec(line) : null
  return split ? { commandLine: split[2], parent: Number(split[1]) } : null
}

/** Walks up from the worker's parent until a process carries `--user-data-dir`. */
export async function userDataDirOfHost(startPid: number, lookup: ProcessLookup = lookupProcess): Promise<string | null> {
  let pid: number | null = startPid
  for (let level = 0; level < MAX_LEVELS && pid; level += 1) {
    const info = await lookup(pid)
    if (!info) {
      return null
    }
    const folder = parseUserDataDir(info.commandLine)
    if (folder) {
      return folder
    }
    pid = info.parent
  }
  return null
}
