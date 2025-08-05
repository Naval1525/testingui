import { useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

/**
 * Handles the Google OAuth redirect.
 *
 * On mount this component parses query/hash parameters for
 *   - token or access_token
 *   - user (URL-encoded JSON)
 *   - error
 * Then it passes the data to AuthContext and navigates to the homepage.
 */
const GoogleRedirect = () => {
  const { handleAuthSuccess } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    const parseParams = () => {
      // Combine search (?a=1) and hash (#b=2) because providers differ.
      let queryString = window.location.search;
      if (!queryString || queryString === '?') {
        // Some flows deliver params in the hash fragment.
        queryString = window.location.hash.startsWith('#')
          ? window.location.hash.substring(1)
          : '';
      } else {
        // Remove leading "?"
        queryString = queryString.substring(1);
      }

      const params = new URLSearchParams(queryString);
      const token = params.get('token') || params.get('access_token');
      const userStr = params.get('user') || params.get('user_data');
      const error = params.get('error');

      if (error) {
        console.error('OAuth error:', error);
        navigate('/', { replace: true });
        return;
      }

      if (token) {
        let user = null;
        try {
          user = userStr ? JSON.parse(decodeURIComponent(userStr)) : null;
        } catch (err) {
          console.error('Failed to parse user data', err);
        }

        handleAuthSuccess({ access_token: token, user });
      }

      // Whether we succeeded or not, always return to home.
      navigate('/', { replace: true });
    };

    parseParams();
    // We only need to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render nothing – this is a logic-only route.
  return null;
};

export default GoogleRedirect;
