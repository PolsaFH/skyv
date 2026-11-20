const time = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' })
const full = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })

/** "i dag kl. 14:32", "i går kl. 09:10", "3. mars kl. 12:00". */
export function formatWhen(iso: string | undefined, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  const t = time.format(d)
  if (days === 0) return `i dag kl. ${t}`
  if (days === 1) return `i går kl. ${t}`
  if (d.getFullYear() === now.getFullYear()) return `${dayMonth.format(d)} kl. ${t}`
  return `${full.format(d)} kl. ${t}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} byte`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',')} kB`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "for 2 minutter siden", "akkurat nå", "for 3 timer siden", or a date for older times. */
export function formatAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 45) return 'akkurat nå'
  const m = Math.round(s / 60)
  if (m < 60) return `for ${m === 1 ? 'ett minutt' : `${m} minutter`} siden`
  const h = Math.round(m / 60)
  if (h < 24) return `for ${h === 1 ? 'en time' : `${h} timer`} siden`
  return formatWhen(iso)
}
