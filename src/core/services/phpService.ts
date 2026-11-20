import { findPhp, type PhpInfo } from '../php/php'

let cached: Promise<PhpInfo | null> | null = null

/**
 * PHP on this Mac, looked up once and cached. Searches PATH plus /opt/homebrew/bin/php and
 * /usr/local/bin/php, because apps opened from Finder do not get the Terminal's PATH.
 * Used for the PHP syntax check before release and for local preview with `php -S`.
 */
export function getPhp(refresh = false): Promise<PhpInfo | null> {
  if (!cached || refresh) cached = findPhp().catch(() => null)
  return cached
}
