import React from 'react';
import { AuthPortal } from '../components/auth/AuthPortal';

export const LoginPage: React.FC = () => {
  return <AuthPortal initialMode="login" />;
};
