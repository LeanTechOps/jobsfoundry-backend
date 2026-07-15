export interface PlanConfig {
  displayName: string
  popular: boolean
  features: string[]
}

export const PRICING_FEATURES: Record<string, PlanConfig> = {
  FORGE: {
    displayName: 'Forge',
    popular: false,
    features: [
      'Up to 1 application per day',
      '1 resume profile',
      'Basic job tracker',
      'Application status tracking',
    ],
  },

  CRAFT: {
    displayName: 'Craft',
    popular: false,
    features: [
      'Up to 3–5 applications per day*',
      'Up to 3 resume profiles',
      'Resume tailoring',
      'Cover letter support',
      'Advanced job tracking',
      'Basic interview preparation',
    ],
  },

  LAUNCH: {
    displayName: 'Launch',
    popular: true,
    features: [
      'Up to 8–10 applications per day*',
      'Up to 5 resume profiles',
      'Tailored resumes and cover letters',
      'Advanced interview preparation',
      'Priority application processing',
      'Advanced job search insights',
    ],
  },

  MOMENTUM: {
    displayName: 'Momentum',
    popular: false,
    features: [
      'Complete Market Coverage',
      'Applications submitted for every eligible matching job available that day',
      'Unlimited resume profiles',
      'Tailored resumes and cover letters',
      'Advanced tracking and insights',
      'Priority preparation and processing',
      'Premium interview support',
    ],
  },

}
