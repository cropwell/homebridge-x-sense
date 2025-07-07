export enum DeviceCapability {
  Smoke = 'smoke',
  CarbonMonoxide = 'co',
}

const MODEL_CAPABILITIES: Record<string, DeviceCapability[]> = {
  'SC06-WX': [DeviceCapability.Smoke, DeviceCapability.CarbonMonoxide],
  'SC07-WX': [DeviceCapability.Smoke, DeviceCapability.CarbonMonoxide],
  'XP0A-MR': [DeviceCapability.Smoke, DeviceCapability.CarbonMonoxide],
  'XC0C-iR': [DeviceCapability.CarbonMonoxide],
  'XC01-M': [DeviceCapability.CarbonMonoxide],
  'XC04-WX': [DeviceCapability.CarbonMonoxide],
  'XP02S-MR': [DeviceCapability.Smoke],
  'XS01-M': [DeviceCapability.Smoke],
  'XS01-WX': [DeviceCapability.Smoke],
  'XS03-iWX': [DeviceCapability.Smoke],
  'XS03-WX': [DeviceCapability.Smoke],
  'XS0D-MR': [DeviceCapability.Smoke],
};

export function detectCapabilities(model: string): DeviceCapability[] {
  for (const [prefix, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (model.startsWith(prefix)) {
      return caps;
    }
  }
  return [DeviceCapability.Smoke, DeviceCapability.CarbonMonoxide];
}
