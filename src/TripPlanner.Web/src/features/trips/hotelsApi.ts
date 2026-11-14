import type { Point } from "../activities/activitiesApi";
import { planningRequest } from "../activities/activityPlanApi";

export type HotelWrite = {
  name: string;
  geometry: Point;
  address: string | null;
  timeZone: string | null;
};
export type Hotel = HotelWrite & {
  id: string;
  tripId: string;
  version: number;
  etag: string;
};
const path = (tripId: string) => `/trips/${encodeURIComponent(tripId)}/hotels`;
export const listHotels = (tripId: string) =>
  planningRequest<Hotel[]>(path(tripId));
export const getHotel = (tripId: string, hotelId: string) =>
  planningRequest<Hotel>(`${path(tripId)}/${encodeURIComponent(hotelId)}`);
export const createHotel = (tripId: string, request: HotelWrite) =>
  planningRequest<Hotel>(path(tripId), { method: "POST", body: request });
export const replaceHotel = (
  tripId: string,
  value: Hotel,
  request: HotelWrite,
) =>
  planningRequest<Hotel>(`${path(tripId)}/${value.id}`, {
    method: "PUT",
    etag: `"${value.etag}"`,
    body: request,
  });
export const deleteHotel = (tripId: string, value: Hotel) =>
  planningRequest(`${path(tripId)}/${value.id}`, {
    method: "DELETE",
    etag: `"${value.etag}"`,
  });
