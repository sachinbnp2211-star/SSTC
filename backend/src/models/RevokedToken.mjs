import mongoose from 'mongoose'

const revokedTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
  },
  { timestamps: true },
)

const RevokedToken = mongoose.models.RevokedToken || mongoose.model('RevokedToken', revokedTokenSchema)

export default RevokedToken
