import mongoose from 'mongoose'
import { env } from './env.mjs'

let databaseConnection = null

export async function connectDatabase() {
  if (!env.MONGODB_URI) {
    console.warn('MONGODB_URI is not configured; continuing without a live MongoDB connection.')
    return null
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection
  }

  try {
    databaseConnection = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })
    console.log('MongoDB connected successfully')
    return databaseConnection.connection
  } catch (error) {
    console.warn('MongoDB connection unavailable; authentication APIs will remain unavailable.')
    return null
  }
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1
}
