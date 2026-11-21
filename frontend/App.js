import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './src/context/AuthContext';

import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import VerifyOtpScreen from './src/screens/VerifyOtpScreen';
import PendingScreen from './src/screens/PendingScreen';
import AdminApprovalsScreen from './src/screens/admin/AdminApprovalsScreen';
import RiderHomeScreen from './src/screens/rider/RiderHomeScreen';
import RequestRideScreen from './src/screens/rider/RequestRideScreen';
import WaitingScreen from './src/screens/rider/WaitingScreen';
import TrackingScreen from './src/screens/rider/TrackingScreen';
import DriverHomeScreen from './src/screens/driver/DriverHomeScreen';
import DriverRideScreen from './src/screens/driver/DriverRideScreen';
import SupportChatScreen from './src/screens/SupportChatScreen';
import SupportInboxScreen from './src/screens/admin/SupportInboxScreen';
import SupportThreadScreen from './src/screens/admin/SupportThreadScreen';
import PostRideScreen from './src/screens/driver/PostRideScreen';
import FindRideScreen from './src/screens/rider/FindRideScreen';
import OfferDetailScreen from './src/screens/OfferDetailScreen';
import FullMapScreen from './src/screens/FullMapScreen';

import { colors } from './src/theme/colors';

const Stack = createNativeStackNavigator();

function RootNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} />
        <Stack.Screen name="Pending" component={PendingScreen} />
      </Stack.Navigator>
    );
  }

  if (user.role === 'admin') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AdminApprovals" component={AdminApprovalsScreen} />
        <Stack.Screen name="SupportInbox" component={SupportInboxScreen} />
        <Stack.Screen name="SupportThread" component={SupportThreadScreen} />
      </Stack.Navigator>
    );
  }

  if (user.role === 'driver') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
        <Stack.Screen name="DriverRide" component={DriverRideScreen} />
        <Stack.Screen name="PostRide" component={PostRideScreen} />
        <Stack.Screen name="OfferDetail" component={OfferDetailScreen} />
        <Stack.Screen name="FullMap" component={FullMapScreen} />
        <Stack.Screen name="Support" component={SupportChatScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RiderHome" component={RiderHomeScreen} />
      <Stack.Screen name="RequestRide" component={RequestRideScreen} />
      <Stack.Screen name="Waiting" component={WaitingScreen} />
      <Stack.Screen name="Tracking" component={TrackingScreen} />
      <Stack.Screen name="FindRide" component={FindRideScreen} />
      <Stack.Screen name="OfferDetail" component={OfferDetailScreen} />
      <Stack.Screen name="FullMap" component={FullMapScreen} />
      <Stack.Screen name="Support" component={SupportChatScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <RootNavigator />
        <StatusBar style="auto" />
      </NavigationContainer>
    </AuthProvider>
  );
}
