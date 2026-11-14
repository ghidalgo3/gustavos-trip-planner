import {
  Avatar,
  Button,
  Card,
  CardHeader,
  LargeTitle,
  SkeletonItem,
  Subtitle1,
  Text,
  Title3,
} from "@fluentui/react-components";
import {
  Location24Regular,
  Person24Regular,
  SignOut24Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import {
  getCurrentUser,
  loginUrl,
  logoutUrl,
  profileImageUrl,
  type CurrentUser,
  type UserProfile,
} from "../api/api";
import { HttpResponseError, isAccessDenied } from "../api/httpErrors";
import { readOfflineUser, rememberOfflineUser } from "../api/offlineCache";
import { clearTripDocumentCache } from "../api/tripDocumentStore";
import HomeCityPicker from "../features/profile/HomeCityPicker";
import ProfilePage from "../features/profile/ProfilePage";
import TripPlanningPage from "../features/trips/TripPlanningPage";
import TripsDashboard from "../features/trips/TripsDashboard";
import NoticesPage from "../features/notices/NoticesPage";
import ContentSkeleton from "../shared/components/ContentSkeleton";
import OfflineNotice from "../shared/components/OfflineNotice";
import BehaviorTracking from "../telemetry/BehaviorTracking";
import { trackBehavior } from "../telemetry/telemetry";
import ScrollPositionRestoration from "./ScrollPositionRestoration";

const emptyProfile: UserProfile = { homeCity: null, preferredAirlines: [] };

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<CurrentUser>();
  const [apiAvailable, setApiAvailable] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const userMenu = useRef<HTMLDetailsElement>(null);
  const profile = user?.profile ?? emptyProfile;

  const acceptUser = useCallback((value: CurrentUser) => {
    const previous = readOfflineUser();
    if (!value.isAuthenticated || (previous && previous.id !== value.id))
      clearTripDocumentCache();
    if (value.isAuthenticated) rememberOfflineUser(value);
    setUser(value);
    setOffline(false);
    setApiAvailable(true);
  }, []);

  async function openProfile() {
    if (offline) return;
    try {
      acceptUser(await getCurrentUser());
    } catch {
      /* Retry on the profile route. */
    }
    userMenu.current?.removeAttribute("open");
    navigate("/profile");
  }

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    async function restoreSession() {
      try {
        if (navigator.onLine === false) throw new TypeError("Offline");
        const value = await getCurrentUser(controller.signal);
        if (!cancelled) acceptUser(value);
      } catch (reason) {
        if (cancelled) return;
        if (isAccessDenied(reason)) {
          acceptUser({
            isAuthenticated: false,
            completedOnboarding: false,
            profile: emptyProfile,
          });
          return;
        }
        setApiAvailable(false);
        // A cached identity permits local reading only. An explicit rejection
        // from the API must never be treated as a disconnected session.
        if (!(reason instanceof HttpResponseError) || reason.status >= 500) {
          const previous = readOfflineUser();
          if (previous) {
            setUser(previous);
            setOffline(true);
          }
        }
      }
    }
    void restoreSession().finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [acceptUser, refresh]);

  useEffect(() => {
    const reconnect = () => setRefresh((value) => value + 1);
    const disconnect = () => setOffline(true);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", disconnect);
    return () => {
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", disconnect);
    };
  }, []);

  useEffect(() => {
    if (!offline) return;
    // A failed request can recover without the browser emitting an online event.
    const timer = window.setInterval(() => {
      if (navigator.onLine !== false) setRefresh((value) => value + 1);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [offline]);

  return (
    <main>
      <BehaviorTracking user={user} />
      <ScrollPositionRestoration />
      <header className="topbar">
        <Link className="brand" to="/">
          <Location24Regular aria-hidden="true" />
          <Text weight="semibold" size={400}>
            Trip Planner
          </Text>
        </Link>
        {user?.isAuthenticated && (
          <div className="user-actions">
            <details className="user-menu" ref={userMenu}>
              <summary aria-label="User profile">
                <Avatar
                  name={user.name ?? user.email ?? "Traveler"}
                  image={{ src: profileImageUrl() }}
                />
                <span>{user.name ?? user.email ?? "Traveler"}</span>
              </summary>
              <div className="user-menu-panel">
                <button
                  type="button"
                  disabled={offline}
                  onClick={() => void openProfile()}
                >
                  <Person24Regular /> Your profile
                </button>
                <a href={logoutUrl()} onClick={clearTripDocumentCache}>
                  <SignOut24Regular /> Sign out
                </a>
              </div>
            </details>
          </div>
        )}
      </header>

      <OfflineNotice
        offline={offline && !!user?.isAuthenticated}
        onRetry={() => setRefresh((value) => value + 1)}
      />
      {location.pathname === "/notices" ? (
        <NoticesPage />
      ) : user?.isAuthenticated &&
        user.id &&
        (user.completedOnboarding || location.pathname === "/profile") ? (
        <Routes>
          <Route
            path="/"
            element={
              <TripsDashboard
                key={user.id}
                user={{ ...user, id: user.id }}
                offline={offline}
                onSessionExpired={() =>
                  acceptUser({
                    isAuthenticated: false,
                    completedOnboarding: false,
                    profile: emptyProfile,
                  })
                }
              />
            }
          />
          <Route
            path="/trips/:tripId/*"
            element={
              <TripPlanningPage
                userId={user.id}
                offline={offline}
                homeCity={profile.homeCity?.name ?? null}
              />
            }
          />
          <Route
            path="/profile"
            element={
              offline ? (
                <section className="planning-page">
                  <Text>Connect to the internet to manage your profile.</Text>
                  <Button onClick={() => navigate("/")}>Back to trips</Button>
                </section>
              ) : (
                <ProfilePage user={{ ...user, profile }} onSaved={acceptUser} />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <section className="hero">
          <div className="hero-copy">
            <Text className="eyebrow" weight="semibold">
              YOUR NEXT STORY STARTS HERE
            </Text>
            <LargeTitle>Make room for the trip, not the busywork.</LargeTitle>
            <Subtitle1>
              Keep destinations, dates, and ideas together in one calm place.
            </Subtitle1>

            {!apiAvailable ? (
              <Text role="alert">
                No saved account is available on this device. Open this app
                online and sign in first.
              </Text>
            ) : !user ? (
              <ContentSkeleton label="Checking your session">
                <div className="auth-actions">
                  <SkeletonItem style={{ width: 180, height: 40 }} />
                  <SkeletonItem style={{ width: 180, height: 40 }} />
                </div>
              </ContentSkeleton>
            ) : user.isAuthenticated ? (
              <div className="welcome" aria-label="Complete your profile">
                <Title3 as="h2">Where do you call home?</Title3>
                <Text>
                  We’ll use your home city as the starting point when planning
                  trips.
                </Text>
                <HomeCityPicker onSaved={acceptUser} />
              </div>
            ) : (
              <div className="auth-actions" aria-label="Sign in options">
                <a
                  href={loginUrl("google")}
                  className="provider-sign-in"
                  onClick={() => trackBehavior("sign_in_started")}
                >
                  <img
                    src="/auth/sign-in-with-google.svg"
                    alt="Sign in with Google"
                    width="180"
                    height="40"
                  />
                </a>
                <a
                  href={loginUrl("aad")}
                  className="provider-sign-in"
                  onClick={() => trackBehavior("sign_in_started")}
                >
                  <img
                    src="/auth/sign-in-with-microsoft.svg"
                    alt="Sign in with Microsoft"
                    width="215"
                    height="41"
                  />
                </a>
              </div>
            )}
          </div>

          <Card className="postcard" appearance="filled-alternative">
            <CardHeader
              image={
                <div className="postcard-icon">
                  <Location24Regular />
                </div>
              }
              header={<Title3>Everything in one itinerary</Title3>}
              description={
                <Text>
                  Dates, notes, and destinations are ready when inspiration
                  strikes.
                </Text>
              }
            />
            <div className="route" aria-hidden="true">
              <span>Home</span>
              <span className="route-line" />
              <span>Somewhere wonderful</span>
            </div>
          </Card>
        </section>
      )}
      <footer className="app-footer">
        <Link to="/notices" onClick={() => window.scrollTo(0, 0)}>
          Notices
        </Link>
      </footer>
    </main>
  );
}
