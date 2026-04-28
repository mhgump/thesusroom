import fs from 'node:fs'
import path from 'node:path'
import { SKILLS_DIR } from '../../../shared/paths.js'

const SKILL_DOC = 'SKILL.md'

// Reads skills/<name>/SKILL.md, then every other file in the skill directory
// (sorted), joined with markdown separators. The SKILL doc leads so the agent
// sees the overview before the longer supporting docs.
export function loadSkill(name: string): string {
  const dir = path.join(SKILLS_DIR, name)
  const skillPath = path.join(dir, SKILL_DOC)
  const parts: string[] = [fs.readFileSync(skillPath, 'utf8')]

  const extras = fs
    .readdirSync(dir)
    .filter(f => f !== SKILL_DOC)
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .sort()

  for (const f of extras) {
    const body = fs.readFileSync(path.join(dir, f), 'utf8')
    parts.push(`# ${f}\n\n${body}`)
  }

  return parts.join('\n\n---\n\n')
}
