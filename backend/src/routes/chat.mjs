import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.mjs'
import { answerChatQuestion } from '../services/chatService.mjs'

const router = Router()

router.use(requireAuth, requireRole('APPLICANT'))

router.post('/', async (req, res) => {
  try {
    const result = await answerChatQuestion(req.body?.question)
    return res.json(result)
  } catch (error) {
    const status = error?.statusCode || 400
    return res.status(status).json({ error: error.message || 'Chat request could not be completed.' })
  }
})

export default router
