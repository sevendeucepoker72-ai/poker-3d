// Avatar customization options catalog

export const BODY_TYPES = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'male_athletic', label: 'Male Athletic' },
  { id: 'female_athletic', label: 'Female Athletic' },
];

export const SKIN_TONES = [
  '#FFDBB4', '#E8B88A', '#C68642', '#8D5524', '#5C3A1E', '#3B2210',
];

export const HAIR_STYLES = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
  { id: 'buzz', label: 'Buzz Cut' },
  { id: 'slickback', label: 'Slick Back' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'afro', label: 'Afro' },
  { id: 'bald', label: 'Bald' },
];

export const HAIR_COLORS = [
  '#2C1B0E', '#5A3825', '#8B6914', '#C4A35A', '#D4A574',
  '#1A1A1A', '#808080', '#C0C0C0', '#8B0000', '#FF4500',
];

export const EYE_COLORS = [
  '#4A90D9', '#2E5A1E', '#8B6914', '#3B2F2F', '#1A1A1A', '#6B8E23',
];

export const TOP_STYLES = [
  { id: 'tshirt', label: 'T-Shirt' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'suit', label: 'Suit Jacket' },
  { id: 'polo', label: 'Polo' },
  { id: 'tanktop', label: 'Tank Top' },
  { id: 'dress_shirt', label: 'Dress Shirt' },
];

export const TOP_COLORS = [
  '#1A1A2E', '#E63946', '#457B9D', '#2A9D8F', '#E9C46A',
  '#FFFFFF', '#264653', '#F4A261', '#6B4226', '#8338EC',
];

export const BOTTOM_STYLES = [
  { id: 'jeans', label: 'Jeans' },
  { id: 'slacks', label: 'Slacks' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'skirt', label: 'Skirt' },
];

export const BOTTOM_COLORS = [
  '#2D3A4A', '#1A1A1A', '#4A3728', '#1B3A2D', '#3D3D3D',
];

export const ACCESSORIES = [
  { id: 'none', label: 'None' },
  { id: 'sunglasses', label: 'Sunglasses' },
  { id: 'aviators', label: 'Aviator Glasses' },
  { id: 'cap', label: 'Baseball Cap' },
  { id: 'visor', label: 'Poker Visor' },
  { id: 'gold_chain', label: 'Gold Chain' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'beanie', label: 'Beanie' },
];

export const FACE_SLIDERS = [
  { id: 'jawWidth', label: 'Jaw Width', min: 0, max: 1 },
  { id: 'noseLength', label: 'Nose Size', min: 0, max: 1 },
  { id: 'cheekHeight', label: 'Cheek Height', min: 0, max: 1 },
  { id: 'browHeight', label: 'Brow Height', min: 0, max: 1 },
  { id: 'lipFullness', label: 'Lip Fullness', min: 0, max: 1 },
  { id: 'eyeSize', label: 'Eye Size', min: 0, max: 1 },
];

// Serialize avatar config for saving/network transfer
export function serializeAvatar(avatar) {
  return JSON.stringify(avatar);
}

export const DEFAULT_AVATAR = {
  bodyType: 'male',
  skinTone: '#C68642',
  hairStyle: 'short',
  hairColor: '#2C1B0E',
  eyeColor: '#4A90D9',
  topStyle: 'tshirt',
  topColor: '#1A1A2E',
  bottomStyle: 'jeans',
  bottomColor: '#2D3A4A',
  accessory: 'none',
  faceShape: { jawWidth: 0.5, noseLength: 0.5, cheekHeight: 0.5, browHeight: 0.5, lipFullness: 0.5, eyeSize: 0.5 },
};

export function deserializeAvatar(json) {
  try {
    return JSON.parse(json);
  } catch {
    return { ...DEFAULT_AVATAR };
  }
}
