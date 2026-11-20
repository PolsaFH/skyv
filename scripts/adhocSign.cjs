// Ad-hoc sign the whole app bundle after packaging (no Apple Developer ID needed).
// Without this the bundle signature is incomplete, and macOS reports a downloaded copy as "damaged".
// With it, macOS only says the developer cannot be verified, and the user can choose "Open Anyway".
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
