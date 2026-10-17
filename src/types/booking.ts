export type BookingStatus = 'confirmed' | 'canceled' | 'completed';

export interface Booking {
  id: string;
  venueId: string;
  venueName: string;
  /** None today: the bookings API carries no venue image (never a stock photo). */
  venueImageUrl?: string;
  activityName: string;
  bookingTime: Date;
  status: BookingStatus;
  creditCost: number;
  isLuxury: boolean;
}
