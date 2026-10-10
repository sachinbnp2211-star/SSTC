import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: false,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['APPLICANT', 'OFFICER', 'GENERAL_OFFICER', 'HUMAN_VERIFIER', 'ADMIN'],
      default: 'APPLICANT',
      required: true,
    },
    departmentId: {
      type: String,
      default: null,
    },
    governmentOfficerId: {
      type: String,
      default: null,
      uppercase: true,
      trim: true,
    },
    accountStatus: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', null],
      default: null,
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    setupTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    setupTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    registrationAccessTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    registrationAccessTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    officerApprovedAt: {
      type: Date,
      default: null,
    },
    officerApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    officerRejectedAt: {
      type: Date,
      default: null,
    },
    officerRejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    officerRejectionReason: {
      type: String,
      default: null,
      maxlength: 2000,
    },
    permissions: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
)

userSchema.index(
  { governmentOfficerId: 1 },
  {
    unique: true,
    partialFilterExpression: { governmentOfficerId: { $type: 'string' } },
    name: 'user_government_officer_id_unique',
  },
)

userSchema.methods.toSafeObject = function toSafeObject() {
  const user = this.toObject({ versionKey: false })
  delete user.passwordHash
  delete user.setupTokenHash
  delete user.setupTokenExpiresAt
  return user
}

const User = mongoose.models.User || mongoose.model('User', userSchema)

export default User
