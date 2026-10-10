import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.mjs'
import RevokedToken from '../models/RevokedToken.mjs'
import { findUserById, hasPermission, isRole } from '../services/authService.mjs'

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, permissions: user.permissions || [] },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, jwtid: randomUUID() },
  )
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' })
  }

  let payload
  try {
    payload = jwt.verify(token, env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }

  if (typeof payload !== 'object' || !payload.sub || !payload.jti || !payload.exp) {
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }

  Promise.all([
    findUserById(payload.sub),
    RevokedToken.exists({ tokenId: payload.jti }),
  ])
    .then(([user, revokedToken]) => {
      if (!user || !user.isActive || revokedToken) {
        return res.status(401).json({ error: 'Invalid session.' })
      }
      req.user = { ...user, permissions: user.permissions || [] }
      req.authTokenId = payload.jti
      req.authTokenExpiresAt = new Date(payload.exp * 1000)
      return next()
    })
    .catch(next)
  return undefined
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user
    if (!user || !isRole(user, ...roles)) {
      return res.status(403).json({ error: 'This action is not permitted for the current role.' })
    }
    return next()
  }
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.user
    if (!user || !hasPermission(user, permission)) {
      return res.status(403).json({ error: 'This action requires the required permission.' })
    }
    return next()
  }
}

export function requireOfficerPasswordChanged(req, res, next) {
  if (req.user?.role === 'OFFICER' && req.user.mustChangePassword) {
    return res.status(403).json({
      error: 'Change your temporary password before accessing the Officer workspace.',
      code: 'OFFICER_PASSWORD_CHANGE_REQUIRED',
    })
  }
  return next()
}
