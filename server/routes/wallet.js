const assert = require('assert')
const express = require('express');
const router = express.Router();
const handler = require('./handler')

const {fio} = require('../api')
const plugins = require('../plugins')
const {trimKeys} = require('../db/helper')

const transactions = require('../db/transactions')
const db = require('../db/models')
const {Sequelize, sequelize} = db
const {Op} = Sequelize

const {PublicKey} = require('@fioprotocol/fiojs').Ecc
const {isValidAddress} = require('../../src/validate')

if(process.env.MIN_ADDRESS_PRICE == null) {
  throw new Error('Required: process.env.MIN_ADDRESS_PRICE')
}

/**
  @api {get} /public-api/check-public-key/:publicKey check-public-key
  @apiGroup Registration
  @apiName CheckPublicKey
  @apiDescription
  Check a FIO public key <b>FIO5fnvQ&hellip;ZSYu</b>

  @apiSampleRequest /public-api/check-public-key/FIO6x12sCzAMVSMPM2KAFGiQ6bfLzYPcNQmUyxJ5nkzgj8WESL2qK
*/
router.get('/public-api/check-public-key/:publicKey', handler(async (req, res) => {
  const isPublicKey = PublicKey.isValid(req.params.publicKey)
  return res.send({success: isPublicKey})
}))

router.post('/public-api/ref-wallet', handler(async (req, res) => {
  let {referralCode} = req.body

  if(!referralCode) {
    referralCode = process.env.DEFAULT_REFERRAL_CODE
  }

  const wallet = await db.Wallet.findOne({
    attributes: [
      'id', 'name', 'logo_url', 'domains',
      'domain_sale_price',
      'account_sale_price',
      'domain_sale_active',
      'account_sale_active'
    ],
    where: {
      referral_code: referralCode,
      active: true
    }
  })

  const {
    id, name, logo_url, domains,
    domain_sale_price,
    account_sale_price,
    domain_sale_active,
    account_sale_active
  } = wallet || {}

  return res.send({success: wallet});
}))

/**
  @api {post} /public-api/buy-address buy-address
  @apiGroup Registration
  @apiName PostBuyAddress
  @apiDescription
  Open a payment / charge with the payment provider then return the blockchain
  <b>payment addresses</b> and <b>payment amounts</b>.  The registration server
  will monitor for payment(s) then register the address or domain on the
  blockchain.

  If an account or domain was over or under paid, the <b>payment amounts</b>
  will reflect this reduced amount on the next purchase.  Balances may be
  viewed and adjusted in the admin interface.

  @apiParamExample {json} POST-Example:
  {
    address: String, // Address 'address@domain' or domain without @ symbol 'newdomain'
    referralCode: String, // Wallet referral code, from admin interface
    publicKey: String, // Full FIO public key (like: FIO5fnv..DZSYu)
    redirectUrl: String // [OPTIONAL] Re-direct URL sent to payment processor
  }

  @apiSuccessExample Success-Response: (one of the examples)
  // User had enough credit to cover the purchase, or this server added wallet
  // provider API security and made the account free in this API call.
  HTTP/1.1 200 OK
  {
    success: true,
    account_id: Number,
    error: false
  }

  .. or ..

  // A payment is required
  HTTP/1.1 200 OK
  {
    success: {
      charge: {
        event_id = 0, // Always zero on create, incremental event IDs used in webhook
        pending: true, // Pending as defined in the payment plugin after inspecting the initial charge status (extern_status).
        extern_id: String, // Payment processor's ID 'L3WFJJTC'
        extern_status: String, // Payment processor's status 'NEW'
        extern_time: String, // Payment processor's ISO time '2020-02-22T14:07:40Z'
        metadata: null, // JSON string if processor provides extra info (webhook provides this later)
        pay_source: String, // 'coinbase', 'free', future payment processor
        forward_url: String, // Processor's public URL for payment screen 'https://commerce.coinbase.com/charges/L3WFJJTC'
        pricing: { // Amount due in full or less credit (if any)
          local: {
            amount: "0.030000",
            currency: "USDC"
          },
          bitcoincash: {
            amount: "0.00008158",
            currency: "BCH"
          }
          // litecoin, bitcoin, ethereum, usdc, etc.
        }
        addresses: { // Payment addresses
          bitcoincash: "qzf7u3s83j8mz4t208rvygstmtkls89kvylmgfapj3",
          litecoin: "MQ4DpbTCZuANnGe4QB5b2LVNsM8Ww7PwWK",
          bitcoin: "3J2MGSGSmweD6mMMCJGEwtsMXHNFJ42ueV",
          ethereum: "0x72f11a3274e3b92c0daf9f5f770d99e2a0d50775",
          usdc: "0x72f11a3274e3b92c0daf9f5f770d99e2a0d50775"
          // Note: future coins may be added and will still work but may not appear this server's in-app checkout..
        }
      }
    },
    account_id: Number, // Unique account ID for this registration server
    error: false
  }

  @apiError ReferralCodeNotFound A wallet with this referral does not exist
  @apiErrorExample {json} ReferralCodeNotFound
  HTTP/1.1 404 Not Found
  {
    error: 'Referral code not found',
    success: false
  }

  @apiError NothingForSale Account or domain sale has no price or is not active
  @apiErrorExample {json} NothingForSale
  HTTP/1.1 400 Bad Request
  {
    error: `This referral code is not selling ${type}s.` // type = domain|account
    success: false
  }

  @apiError InvalidAddress Account or domain format is invalid
  @apiErrorExample {json} InvalidAddress
  HTTP/1.1 400 Bad Request
  {
    error: `Invalid ${type}`, // type = domain|account
    success: false
  }

  @apiError AlreadyRegistered Account or domain is already register on the blockchain
  @apiErrorExample {json} AlreadyRegistered
  HTTP/1.1 400 Bad Request
  {
    error: 'Already registered',
    success: false
  }

  @apiError Unauthorized The Wallet is configured with a $0 account or domain
  price and this API call did not provide a user API Bearer Token header.
  @apiErrorExample {json} Unauthorized
  HTTP/1.1 400 Bad Request
  {
    error: `Due to the referral code sale price, a user API Bearer Token is required`,
    success: false
  }

  @apiError PriceTooLow The server administrator has set a MIN_ADDRESS_PRICE
  that is higher than the wallet's <b>account</b> sale price.  This is a safety feature.
  This server may be configured for free accounts (price = 0) but it would
  require a feature that adds authentication to this API call.
  @apiErrorExample {json} PriceTooLow
  HTTP/1.1 400 Bad Request
  {
    error: `Price is too low`,
    success: false
  }
*/
router.post('/public-api/buy-address', handler(async (req, res) => {
  const {
    address, referralCode, publicKey,
    redirectUrl
  } = req.body
  const processor = await plugins.payment

  const ref = referralCode ? referralCode : process.env.DEFAULT_REFERRAL_CODE
  const wallet = await db.Wallet.findOne({
    attributes: [
      'id',
      'name',
      'logo_url',
      'domain_sale_price',
      'account_sale_price',
      'domain_sale_active',
      'account_sale_active'
    ],
    where: {
      referral_code: ref,
      active: true
    }
  })

  if(!wallet) {
    return res.status(404).send({error: 'Referral code not found'})
  }

  const addressArray = address.split('@')
  const buyAccount = addressArray.length === 2
  const type = buyAccount ? 'account' : 'domain'

  if(!wallet[`${type}_sale_active`]) {
    return res.status(400).send(
      {error: `This referral code is not selling ${type}s.`}
    )
  }

  if(!isValidAddress(address)) {
    return res.status(400).send(
      {error: `Invalid ${type}`}
    )
  }

  if(await fio.isAccountRegistered(address)) {
    return res.status(404).send({error: `Already registered`})
  }

  const {name, logo_url} = wallet
  const price = +Number(wallet[`${type}_sale_price`])

  if(price === 0) {
    if(!res.state.user_id) {
      return res.status(401).send({error: `Unauthorized: Due to the referral code sale price, a user API Bearer Token is required`})
    }
  }

  // Block free accounts if this server is not forked and implemented for this
  if(type === 'account' && price < process.env.MIN_ADDRESS_PRICE) {
    return res.status(400).send({error: `Price is too low`})
  }

  // apply credit
  const balance = await transactions.balance(publicKey)

  let credit = 0
  if(balance.total) {
    const bal = +Number(balance.total)
    if(bal < 0) {
      credit = bal
    }
  }
  const adjPrice = Math.max(0, +Number(price + credit).toFixed(2))

  const result = await db.sequelize.transaction(async transaction => {
    const tr = {transaction}

    const accountObj = {
      domain: addressArray.length === 1 ? addressArray[0] : addressArray[1],
      address: addressArray.length === 1 ? null : addressArray[0],
      wallet_id: wallet.id
    }

    const [account] = await db.Account.findOrCreate({
      defaults: accountObj,
      where: {
        domain: accountObj.domain,
        address: accountObj.address || null,
        owner_key: publicKey
      },
      transaction
    })

    if(
      (type === 'account' && price === 0) ||
      adjPrice === 0
    ) {
      const accountPay = await db.AccountPay.create({
        pay_source: 'free',
        extern_id: String(Date.now()),
        buy_price: price,
        account_id: account.id,
      }, tr)

      const accountPayEvent = await db.AccountPayEvent.create({
        pay_status: 'success',
        event_id: String(0),
        account_pay_id: accountPay.id
      }, tr)

      return {success: true, account_id: account.id}
    }

    const charge = await processor.createCharge({
      name, logoUrl: logo_url, price: adjPrice, type, address, publicKey,
      accountId: account.id, redirectUrl
    })

    charge.pay_source = process.env.PLUGIN_PAYMENT

    const {
      event_id = 0,
      extern_id,
      extern_status,
      extern_time,
      forward_url
    } = charge

    const metadata = charge.metadata && Object.keys(charge.metadata).length ?
      charge.metadata : null

    const accountPay = await db.AccountPay.create({
      pay_source: process.env.PLUGIN_PAYMENT,
      extern_id,
      buy_price: price,
      metadata,
      account_id: account.id,
      forward_url
    }, tr)

    let pay_status
    if(charge.pending === false) {
      pay_status = 'cancel'
    } else if(charge.pending === true) {
      pay_status = 'pending'
    } else { // event.pending === undefined
      pay_status = 'review'
    }

    const accountPayEvent = await db.AccountPayEvent.create({
      pay_status,
      event_id: String(event_id),
      extern_time,
      extern_status,
      account_pay_id: accountPay.id
    }, tr)

    return {success: {charge}, account_id: account.id}
  })

  return res.send(result);
}))

/** For In-app Checkout.vue */
// router.post('/public-api/cancel-charge/:extern_id', handler(async (req, res) => {
//   const {extern_id} = req.params
//   assert(typeof extern_id === 'string', 'Required parameter: extern_id')
//
//   const processor = await plugins.payment
//   const {success, error} = await processor.cancelCharge(extern_id)
//   return res.send({success, error})
// }))

/** For Checkout.vue */
router.get('/public-api/wallet/:extern_id', handler(async (req, res) => {
  const {extern_id} = req.params
  assert(typeof extern_id === 'string', 'Required parameter: extern_id')

  const pay_source = plugins.payment_name

  let wallet = await db.Wallet.findOne({
    raw: true,
    attributes: ['id', 'logo_url', 'name', 'referral_code'],
    include: {
      model: db.Account, attributes: ['id', 'domain', 'address', 'owner_key'],
      include: {
        model: db.AccountPay, attributes: ['id'],
        where: {pay_source, extern_id}
      }
    }
  })

  if(!wallet) {
    return res.send({error: 'Not found'})
  }

  wallet = trimKeys(wallet)

  if(!wallet.logo_url) {
    wallet.logo_url = '/images/logo.svg'
  }

  return res.send({success: true, wallet })
}))

module.exports = router;
