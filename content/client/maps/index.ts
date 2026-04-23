import { DEMO_CLIENT_MAP } from './demo'
import { SCENARIO1_CLIENT_MAP } from './scenario1'
import { SCENARIO2_CLIENT_MAP } from './scenario2'
import { SCENARIO3_CLIENT_MAP } from './scenario3'
import { SCENARIO4_CLIENT_MAP } from './scenario4'
import { CURRENT_SCENARIO_ID } from './registry'
import type { ClientMap } from './registry'

const CLIENT_MAPS: Record<string, ClientMap> = {
  demo: DEMO_CLIENT_MAP,
  scenario1: SCENARIO1_CLIENT_MAP,
  scenario2: SCENARIO2_CLIENT_MAP,
  scenario3: SCENARIO3_CLIENT_MAP,
  scenario4: SCENARIO4_CLIENT_MAP,
}

export { CURRENT_SCENARIO_ID } from './registry'
export type { ClientMap } from './registry'
export const CURRENT_MAP: ClientMap = CLIENT_MAPS[CURRENT_SCENARIO_ID] ?? DEMO_CLIENT_MAP
