import mongoose from 'mongoose'

const governmentOfficerRegistrySchema = new mongoose.Schema(
  {
    governmentOfficerId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      maxlength: 50,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    departmentId: {
      type: String,
      required: true,
      trim: true,
    },
    officialEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true, versionKey: false },
)

const GovernmentOfficerRegistry = mongoose.models.GovernmentOfficerRegistry ||
  mongoose.model('GovernmentOfficerRegistry', governmentOfficerRegistrySchema)

export default GovernmentOfficerRegistry
