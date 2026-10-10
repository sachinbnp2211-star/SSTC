import app from './app.mjs'
import { env } from './config/env.mjs'
import { connectDatabase } from './config/database.mjs'

const port = env.PORT

async function startServer() {
  await connectDatabase()
  app.listen(port, () => {
    console.log(`HacKBios backend running on http://localhost:${port}`)
  })
}

startServer().catch((error) => {
  console.error('Failed to start HacKBios backend.', error)
  process.exitCode = 1
})
