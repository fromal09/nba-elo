// Username + password accounts (proof of concept): scrypt hashes, random session tokens in an
// httpOnly cookie, only the token's SHA-256 stored server-side.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { db } from './db.js'

const scryptP = promisify(scrypt)
const COOKIE = 'fpr_session'
const DAYS = 60

export const USERNAME = /^[A-Za-z0-9_]{3,20}$/

export async function hashPassword(pw) {
  const salt = randomBytes(16)
  const key = await scryptP(pw, salt, 64, { N: 16384, r: 8, p: 1 })
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function checkPassword(pw, stored) {
  const [v, s, k] = (stored || '').split('$')
  if (v !== 's1' || !s || !k) return false
  const want = Buffer.from(k, 'base64')
  const got = await scryptP(pw, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 })
  return got.length === want.length && timingSafeEqual(got, want)
}

const sha = t => createHash('sha256').update(t).digest('hex')

export async function startSession(res, req, userId) {
  const token = randomBytes(32).toString('base64url')
  const sql = db()
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${sha(token)}, ${userId}, now() + ${DAYS + ' days'}::interval)`
  setCookie(res, req, token, DAYS * 86400)
}

export async function endSession(res, req) {
  const token = readCookie(req)
  if (token) await db()`delete from sessions where token_hash = ${sha(token)}`
  setCookie(res, req, '', 0)
}

export async function currentUser(req) {
  const token = readCookie(req)
  if (!token) return null
  const [u] = await db()`select u.* from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha(token)} and s.expires_at > now()`
  return u || null
}

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

function setCookie(res, req, value, maxAge) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
}
