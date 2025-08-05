// import { useAuth } from '../hooks/useAuth';

// const ChatLoginButton = () => {
//   const { login, loading, error } = useAuth();

//   return (
//     <div className="text-center">
//       {error && (
//         <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-md">
//           <p className="text-red-300 text-sm">
//             {error}
//           </p>
//         </div>
//       )}
      
//       <button
//         onClick={login}
//         disabled={loading}
//         className="w-full flex items-center justify-center gap-3 px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
//       >
//         {loading ? (
//           <>
//             <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
//               <circle
//                 className="opacity-25"
//                 cx="12"
//                 cy="12"
//                 r="10"
//                 stroke="currentColor"
//                 strokeWidth="4"
//                 fill="none"
//               />
//               <path
//                 className="opacity-75"
//                 fill="currentColor"
//                 d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
//               />
//             </svg>
//             Signing in...
//           </>
//         ) : (
//           <>
//             <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
//               <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
//               <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
//               <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
//               <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
//             </svg>
//             Sign in with Google
//           </>
//         )}
//       </button>
//     </div>
//   );
// };

// export default ChatLoginButton; 
// Add these routes to your React Router configuration

// Success callback route
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export const ChatLoginButton = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    // This component is just a fallback - the AuthProvider should handle the logic
    // and redirect automatically. If we reach here, redirect to home.
    navigate('/', { replace: true });
  }, [navigate]);
  
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-b-2 border-blue-600 rounded-full mx-auto mb-4"></div>
        <p>Completing authentication...</p>
      </div>
    </div>
  );
};

// Error callback route
 const AuthError = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Redirect to login or home after a delay
    const timer = setTimeout(() => {
      navigate('/', { replace: true });
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [navigate]);
  
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center max-w-md p-6">
        <div className="text-red-500 mb-4">
          <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-red-700 mb-2">Authentication Failed</h2>
        <p className="text-gray-600 mb-4">There was a problem signing you in. Please try again.</p>
        <button 
          onClick={() => navigate('/', { replace: true })}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Go to Home
        </button>
      </div>
    </div>
  );
};
export default ChatLoginButton;
// Add these to your router:
// <Route path="/auth/callback" element={<AuthCallback />} />
// <Route path="/auth/error" element={<AuthError />} />