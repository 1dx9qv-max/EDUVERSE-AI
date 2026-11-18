import React from 'react';
import { AuthPortal } from '../components/auth/AuthPortal';

export const SignupPage: React.FC = () => {
  return <AuthPortal initialMode="signup" />;
};
