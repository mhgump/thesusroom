// Snapshot + restore for the subset of content/ that a single create-scenario
// iteration is allowed to modify: one scenario (incl. its test_specs), one
// map, and one scenario's bot tree. The plan file and run artifacts live
// elsewhere and are intentionally excluded.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CONTENT_DIR } from './paths.js'

export interface ScenarioTreeSnapshot {
  scenarioId: string
  mapId: string
  tmpDir: string
}

interface SnapshotedPath {
  // Absolute source path inside content/ that was backed up.
  src: string
  // Absolute path inside the tmp dir where the snapshot lives (or null if src
  // did not exist at snapshot time).
  backup: string | null
}

interface SnapshotManifest {
  scenarioId: string
  mapId: string
  entries: SnapshotedPath[]
}

function targets(scenarioId: string, mapId: string): string[] {
  return [
    path.join(CONTENT_DIR, 'scenarios', scenarioId),
    path.join(CONTENT_DIR, 'maps', mapId),
    path.join(CONTENT_DIR, 'bots', scenarioId),
  ]
}

export function snapshotScenarioTree(
  scenarioId: string,
  mapId: string,
): ScenarioTreeSnapshot {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-scenario-snap-'))
  const entries: SnapshotedPath[] = []

  for (const src of targets(scenarioId, mapId)) {
    const rel = path.relative(CONTENT_DIR, src)
    const backup = path.join(tmpDir, rel)
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      fs.cpSync(src, backup, { recursive: true })
      entries.push({ src, backup })
    } else {
      entries.push({ src, backup: null })
    }
  }

  const manifest: SnapshotManifest = { scenarioId, mapId, entries }
  fs.writeFileSync(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  return { scenarioId, mapId, tmpDir }
}

export function restoreScenarioTree(snap: ScenarioTreeSnapshot): void {
  const manifest: SnapshotManifest = JSON.parse(
    fs.readFileSync(path.join(snap.tmpDir, 'manifest.json'), 'utf8'),
  )

  for (const { src, backup } of manifest.entries) {
    fs.rmSync(src, { recursive: true, force: true })
    if (backup !== null && fs.existsSync(backup)) {
      fs.mkdirSync(path.dirname(src), { recursive: true })
      fs.cpSync(backup, src, { recursive: true })
    }
  }
}

export function dropScenarioTreeSnapshot(snap: ScenarioTreeSnapshot): void {
  fs.rmSync(snap.tmpDir, { recursive: true, force: true })
}
