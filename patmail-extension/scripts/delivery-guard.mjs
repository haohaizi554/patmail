const SECRET_NAMES = ['.pem', '.key', 'credentials.json', '.env', 'cookies.txt', 'id_token']

export function forbiddenDeliveryName(name) {
  const normalized = name.replace(/\\/g, '/').toLowerCase()
  const base = normalized.split('/').pop() ?? normalized
  if (base === 'dist.pem' || base.endsWith('.pem')) return 'private-key'
  if (base.endsWith('.key') || base === 'credentials.json') return 'credentials'
  if (base === '.env' || base.startsWith('.env.') || base === 'cookies.txt') return 'secret'
  if (SECRET_NAMES.some(item => base === item || base.endsWith(item))) return 'secret'
  return null
}

export function forbiddenDeliveryNames(names) {
  return names.map(name => ({ name, reason: forbiddenDeliveryName(name) })).filter(item => item.reason)
}
