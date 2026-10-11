






const DEVICE_UID_KEY = 'woe_device_uid'





export function getOrCreateDeviceUid(): string {
  let uid = localStorage.getItem(DEVICE_UID_KEY)
  if (!uid) {
    uid = crypto.randomUUID()
    localStorage.setItem(DEVICE_UID_KEY, uid)
  }
  return uid
}





export function parseDeviceModel(): string {
  const ua = navigator.userAgent


  let browser = 'Unknown Browser'
  if (ua.includes('Firefox/')) {
    const version = ua.split('Firefox/')[1]?.split(' ')[0] || ''
    browser = `Firefox ${version}`
  } else if (ua.includes('Edg/')) {
    const version = ua.split('Edg/')[1]?.split(' ')[0] || ''
    browser = `Edge ${version}`
  } else if (ua.includes('Chrome/')) {
    const version = ua.split('Chrome/')[1]?.split(' ')[0] || ''
    browser = `Chrome ${version}`
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    const version = ua.split('Version/')[1]?.split(' ')[0] || ''
    browser = `Safari ${version}`
  }


  let os = 'Unknown OS'
  if (ua.includes('Windows NT 10')) {
    os = 'Windows 10/11'
  } else if (ua.includes('Windows')) {
    os = 'Windows'
  } else if (ua.includes('Mac OS X')) {
    os = 'macOS'
  } else if (ua.includes('Linux')) {
    os = 'Linux'
  } else if (ua.includes('Android')) {
    os = 'Android'
  } else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os = 'iOS'
  }

  return `${browser} on ${os}`
}
