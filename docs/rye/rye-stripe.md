Payment Providers
Stripe
Use Stripe.js to generate card tokens for Rye checkout intents.

← All Payment Providers
​
Overview
Stripe offers a secure method for tokenizing credit card information using Stripe.js on the frontend. Use this method to collect and tokenize card data directly in the browser. This reduces your PCI scope by avoiding sensitive data transmission through your servers.
​
Use Rye’s Stripe Key to Generate Card Tokens
To generate a Stripe card token for confirming a Rye checkout intent, you must use Rye’s Stripe publishable key, not your own Stripe key.
This ensures the token is created under Rye’s platform account. Using your own key will link the token to your account, causing the checkout intent to fail.
RYE_STRIPE_PUBLISHABLE_KEY_PRODUCTION=pk_live_51LgDhrHGDlstla3fOYU3AUV6QpuOgVEUa1E1VxFnejJ7mWB4vwU7gzSulOsWQ3Q90VVSk1WWBzYBo0RBKY3qxIjV00LHualegh

RYE_STRIPE_PUBLISHABLE_KEY_STAGING=pk_test_51LgDhrHGDlstla3fdqlULAne0rAf4Ho6aBV2cobkYQ4m863Sy0W8DNu2HOnUeYTQzQnE4DZGyzvCB8Yzl1r38isl00H9sVKEMu
​
Generate a Stripe Token Using Demo App
You can use this page to generate a Stripe token for testing payments in the Rye staging environment. For the card number, use Stripe’s test card numbers provided at https://docs.stripe.com/testing.
Alternatively, you can use the steps below to create a simple React app to generate the Stripe token.
​
Generate a Stripe Token Using React App
This guide walks through the Stripe.js approach, including a React demo app.
​
Create a New React App
npm create vite@latest stripe-demo -- --template react
cd stripe-demo
​
Install Stripe Dependencies
npm install @stripe/stripe-js @stripe/react-stripe-js
​
React Example Code
Replace the code in src/App.jsx with the code below.
For testing in Rye staging: use the key on line 14.
For testing in Rye production: use the key on line 11.
import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
Elements,
CardElement,
useStripe,
useElements,
} from '@stripe/react-stripe-js';

// Use the Stripe key on line 11 to test in the Rye production environment. Uncomment line 11 and comment out line 14.
//const stripePromise = loadStripe('pk_live_51LgDhrHGDlstla3fOYU3AUV6QpuOgVEUa1E1VxFnejJ7mWB4vwU7gzSulOsWQ3Q90VVSk1WWBzYBo0RBKY3qxIjV00LHualegh');

// Use the Stripe key on line 14 to test in the Rye staging environment. Uncomment line 14 and comment out line 11. Test card numbers are listed at https://docs.stripe.com/testing.
const stripePromise = loadStripe('pk_test_51LgDhrHGDlstla3fdqlULAne0rAf4Ho6aBV2cobkYQ4m863Sy0W8DNu2HOnUeYTQzQnE4DZGyzvCB8Yzl1r38isl00H9sVKEMu');

const CARD_ELEMENT_OPTIONS = {
style: {
base: {
fontSize: '16px',
color: '#32325d',
fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
'::placeholder': {
color: '#a0aec0',
},
},
invalid: {
color: '#fa755a',
iconColor: '#fa755a',
},
},
};

function StripeJSTokenizer() {
const stripe = useStripe();
const elements = useElements();
const [status, setStatus] = useState('');

const handleSubmit = async e => {
e.preventDefault();
if (!stripe || !elements) return;

    const card = elements.getElement(CardElement);
    const { token, error } = await stripe.createToken(card);

    if (error) {
      setStatus(`❌ ${error.message}`);
    } else {
      setStatus(`✅ Token: ${token.id}`);
      // Optionally send token to your backend
    }

};

return (
<form
      onSubmit={handleSubmit}
      className='max-w-md mx-auto mt-8 p-6 border border-gray-300 rounded-xl shadow-sm bg-white'
    >
<h2 className='text-lg font-semibold mb-4 text-gray-800'>
Enter Card Details
</h2>
<div className='mb-4 p-2 border border-gray-300 rounded'>
<CardElement options={CARD_ELEMENT_OPTIONS} />
</div>
<button
        type='submit'
        disabled={!stripe}
        className='w-full bg-indigo-600 text-white font-medium py-2 px-4 rounded hover:bg-indigo-700 transition'
      >
Tokenize Card
</button>
{status && (
<p className='mt-4 text-sm text-gray-700 bg-gray-100 p-2 rounded'>
{status}
</p>
)}
</form>
);
}

export default function StripeJSDemo() {
return (
<div className='min-h-screen bg-gray-50 flex items-center justify-center'>
<Elements stripe={stripePromise}>
<StripeJSTokenizer />
</Elements>
</div>
);
}

export function App(props) {
return <StripeJSDemo />;
}
​
Run the App Locally
The app will run locally at http://localhost:5173. Open that page in your browser to enter card details and generate a Stripe token. The token will be returned in the format tok*XXXXXXXXXXXXXXXX, where the tok* prefix is followed by a unique identifier.
For testing in the Rye staging environment, use Stripe’s test card numbers provided at https://docs.stripe.com/testing.
npm run dev
​
Generate a Stripe Token Using Other Stripe SDKs
In addition to React, Stripe provides client SDKs for other platforms, such as iOS and Android. For example, if you’re building a mobile app, you can use the Stripe iOS SDK to securely collect card details and generate a payment token directly from your app. The flow is similar across SDKs: Initialize Stripe with your publishable key, present the card entry UI, and Stripe will return a token that you can pass to Rye.
​
Notes
A Stripe token generated through these steps is valid for one-time use only. To submit another order after using a Stripe token, you’ll need to generate a new one.
​
Use the Stripe Token with the Rye API
Once you have a Stripe token, you can use it to complete a purchase through the Rye API. There are two flows available: a single-step purchase and a two-step flow.
​
Single-Step Purchase
Submit a complete purchase in one call by providing the product, buyer details, and payment method together:
curl -X POST https://api.rye.com/v1/checkout-intents/purchase \
 -H "Authorization: Bearer $RYE_API_KEY" \
 -H "Content-Type: application/json" \
 -d ‘{
"productUrl": "https://example-store.myshopify.com/products/example-product",
"quantity": 1,
"buyer": {
"firstName": "Jane",
"lastName": "Doe",
"email": "jane@example.com",
"phone": "+15551234567",
"address1": "123 Main St",
"city": "New York",
"province": "NY",
"postalCode": "10001",
"country": "US"
},
"paymentMethod": {
"type": "stripe_token",
"stripeToken": "<STRIPE_TOKEN>"
}
}’
​
Two-Step Flow
If you have already created a checkout intent, you can submit payment separately using the intent ID:
curl -X POST https://api.rye.com/v1/checkout-intents/{id}/payment \
 -H "Authorization: Bearer $RYE_API_KEY" \
 -H "Content-Type: application/json" \
 -d ‘{
"paymentMethod": {
"type": "stripe_token",
"stripeToken": "<STRIPE_TOKEN>"
}
}’
