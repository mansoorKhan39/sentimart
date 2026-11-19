import { AuditLog } from '../models/auditLog.model.js';
import { logger } from '../utils/logger.js';

// Never throws: a logging problem must not undo or block the admin action that already happened.
export async function recordAudit(req, action, { targetType, targetId, meta } = {}) {
  try {
    await AuditLog.create({ actorId: req.user.id, action, targetType, targetId, meta, ip: req.ip });
  } catch (err) {
    logger.warn('audit log failed', { action, error: err.message });
  }
}
