/** Display labels for the HR fields that flow through profile-change requests. Shared by My Account
 *  (pending banner) and the review queue (current-vs-proposed). The rep-only fields (contact email,
 *  address, uniform sizes) are applied to the rep record on approval. */
export const PROFILE_FIELD_LABEL: Record<string, string> = {
  full_name: 'Full name',
  phone: 'Phone',
  avatar_url: 'Avatar URL',
  email: 'Contact email',
  address_street: 'Street',
  address_city: 'City',
  address_province: 'Province',
  address_postal: 'Postal code',
  jacket_size: 'Jacket size',
  tshirt_size: 'T-shirt size',
};

export function profileFieldLabel(key: string): string {
  return PROFILE_FIELD_LABEL[key] ?? key;
}
