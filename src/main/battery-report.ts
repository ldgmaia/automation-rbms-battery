import { load } from 'cheerio'

export interface BatteryCapacities {
  designCapacityMwh: number
  fullChargeCapacityMwh: number
}

export function parseBatteryReport(html: string): BatteryCapacities {
  const $ = load(html)
  const designText = $('table:nth-of-type(2) tr:nth-child(5) td:nth-child(2)')
    .text()
    .trim()
    .replace(' mWh', '')
    .replace(',', '')
  const fullText = $('table:nth-of-type(2) tr:nth-child(7) td:nth-child(2)')
    .text()
    .trim()
    .replace(' mWh', '')
    .replace(',', '')
  const designCapacityMwh = Number(designText)
  const fullChargeCapacityMwh = Number(fullText)

  if (
    !Number.isFinite(designCapacityMwh) ||
    !Number.isFinite(fullChargeCapacityMwh) ||
    designCapacityMwh <= 0 ||
    fullChargeCapacityMwh <= 0
  ) {
    throw new Error(
      `Battery capacity not valid: Design: ${designText || 'missing'} / Full Charge: ${fullText || 'missing'}`,
    )
  }

  return { designCapacityMwh, fullChargeCapacityMwh }
}

export function calculateBatteryHealth(capacities: BatteryCapacities): number {
  return Math.round(
    (capacities.fullChargeCapacityMwh / capacities.designCapacityMwh) * 100,
  )
}

export function createCompatibleBatteryReport(
  capacities: BatteryCapacities,
): string {
  const rows = [
    ['Battery report', 'Capacity'],
    ['Computer name', 'Ubuntu'],
    ['Installed batteries', 'Battery'],
    ['Battery information', ''],
    ['Design Capacity', `${capacities.designCapacityMwh} mWh`],
    ['Battery information', ''],
    ['Full Charge Capacity', `${capacities.fullChargeCapacityMwh} mWh`],
  ]

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`,
    )
    .join('')

  return `<!doctype html><html><body><table></table><table><tbody>${tableRows}</tbody></table></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
