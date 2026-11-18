import React from 'react';
import { AuthPortal } from '../components/auth/AuthPortal';

export const LandingPage: React.FC = () => {
  return <AuthPortal initialMode="login" />;
};
