import {registerBidder} from '../src/adapters/bidderFactory.js';
import {BANNER} from '../src/mediaTypes.js';
import {isArray, logError, logInfo} from '../src/utils.js';

/**
 * @typedef {import('../src/adapters/bidderFactory.js').BidRequest} BidRequest
 * @typedef {import('../src/adapters/bidderFactory.js').Bid} Bid
 */

const BIDDER_CODE = 'pxyz';
const URL = 'https://ads.playground.xyz/host-config/prebid?v=2';
const DEFAULT_CURRENCY = 'USD';

export const spec = {
  code: BIDDER_CODE,

  // This adapter was previously named playgroundxyz - this alias ensures
  // backwards compatibility for publishers
  aliases: ['playgroundxyz'],

  supportedMediaTypes: [BANNER],

  /**
   * Determines whether or not the given bid request is valid.
   *
   * @param {object} bid The bid to validate.
   * @return boolean True if this is a valid bid, and false otherwise.
   */
  isBidRequestValid: function (bid) {
    return !!(bid.params.placementId);
  },

  /**
   * Make a server request from the list of BidRequests.
   *
   * @param {BidRequest[]} bidRequests A non-empty list of bid requests which should be sent to the Server.
   * @return ServerRequest Info describing the request to the server.
   */
  buildRequests: function (bidRequests, bidderRequest) {
    const referer = bidderRequest.refererInfo.page || bidderRequest.refererInfo.topmostLocation;
    const parts = referer.split('/');

    let protocol, hostname;
    if (parts.length >= 3) {
      protocol = parts[0];
      hostname = parts[2];
    }

    const payload = {
      id: bidderRequest.bidderRequestId,
      site: {
        domain: protocol + '//' + hostname,
        name: hostname,
        page: referer,
      },
      device: {
        ua: navigator.userAgent,
        language: navigator.language,
        devicetype: isMobile() ? 1 : isConnectedTV() ? 3 : 2,
      },
      imp: bidRequests.map(mapImpression),
      Regs: { ext: {} }
    };

    // GDPR
    if (bidderRequest && bidderRequest.gdprConsent) {
      const gdpr = bidderRequest.gdprConsent.gdprApplies ? 1 : 0;
      const consentString = bidderRequest.gdprConsent.consentString;
      logInfo(`PXYZ: GDPR applies ${gdpr}`);
      logInfo(`PXYZ: GDPR consent string ${consentString}`);
      payload.Regs.ext.gdpr = gdpr;
      payload.User = { ext: { consent: consentString } };
    }

    // CCPA
    if (bidderRequest && bidderRequest.uspConsent) {
      logInfo(`PXYZ: USP Consent ${bidderRequest.uspConsent}`);
      payload.Regs.ext['us_privacy'] = bidderRequest.uspConsent;
    }

    return {
      method: 'POST',
      url: URL,
      data: JSON.stringify(payload),
      bidderRequest
    };
  },

  /**
   * Unpack the response from the server into a list of bids.
   *
   * @param {*} serverResponse A successful response from the server.
   * @return {Bid[]} An array of bids which were nested inside the server.
   */
  interpretResponse: function (serverResponse, { bidderRequest }) {
    serverResponse = serverResponse.body;
    const bids = [];

    if (!serverResponse || serverResponse.error) {
      let errorMessage = `in response for ${bidderRequest.bidderCode} adapter`;
      if (serverResponse && serverResponse.error) {
        errorMessage += `: ${serverResponse.error}`;
        logError(errorMessage);
      }
      return bids;
    }

    if (!isArray(serverResponse.seatbid)) {
      let errorMessage = `in response for ${bidderRequest.bidderCode} adapter `;
      logError(errorMessage += 'Malformed seatbid response');
      return bids;
    }

    if (!serverResponse.seatbid) {
      return bids;
    }

    const currency = serverResponse.cur || DEFAULT_CURRENCY;
    serverResponse.seatbid.forEach(sBid => {
      if (Object.prototype.hasOwnProperty.call(sBid, 'bid')) {
        sBid.bid.forEach(iBid => {
          if (iBid.price !== 0) {
            const bid = newBid(iBid, currency);
            bids.push(bid);
          }
        });
      }
    });
    return bids;
  },

  getUserSyncs: function () {
    return [{
      type: 'image',
      url: '//ib.adnxs.com/getuidnb?https://ads.playground.xyz/usersync?partner=appnexus&uid=$UID'
    }, {
      type: 'iframe',
      url: '//rtb.gumgum.com/getuid/15801?r=https%3A%2F%2Fads.playground.xyz%2Fusersync%3Fpartner%3Dgumgum%26uid%3D'
    }];
  }
}

function newBid(bid, currency) {
  const { adomain } = bid;
  return {
    requestId: bid.impid,
    mediaType: BANNER,
    cpm: bid.price,
    creativeId: bid.adid,
    ad: bid.adm,
    width: bid.w,
    height: bid.h,
    ttl: 300,
    netRevenue: true,
    currency: currency,
    meta: {
      ...(adomain && adomain.length > 0 ? { advertiserDomains: adomain } : {})
    }
  };
}

function mapImpression(bid) {
  return {
    id: bid.bidId,
    banner: mapBanner(bid),
    ext: {
      appnexus: {
        placement_id: parseInt(bid.params.placementId, 10)
      },
      pxyz: {
        adapter: {
          vendor: 'prebid',
          prebid: '$prebid.version$'
        }
      }
    }
  };
}

function mapBanner(bid) {
  return {
    w: parseInt(bid.sizes[0][0], 10),
    h: parseInt(bid.sizes[0][1], 10),
    format: mapSizes(bid.sizes)
  };
}

function mapSizes(bidSizes) {
  const format = [];
  bidSizes.forEach(size => {
    format.push({
      w: parseInt(size[0], 10),
      h: parseInt(size[1], 10)
    });
  });
  return format;
}

function isMobile() {
  return (/(ios|ipod|ipad|iphone|android)/i).test(navigator.userAgent);
}

function isConnectedTV() {
  return (/(smart[-]?tv|hbbtv|appletv|googletv|hdmi|netcast\.tv|viera|nettv|roku|\bdtv\b|sonydtv|inettvbrowser|\btv\b)/i).test(navigator.userAgent);
}

registerBidder(spec);
