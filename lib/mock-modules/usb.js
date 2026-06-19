// Mock implementation of usb module for development in Docker
module.exports = {
  getDeviceList: () => [],
  findByIds: () => null,
  on: () => {},
  setDebugLevel: () => {},
  LIBUSB_ENDPOINT_IN: 0x80,
  LIBUSB_ENDPOINT_OUT: 0x00,
  LIBUSB_REQUEST_TYPE_CLASS: (0x01 << 5),
  LIBUSB_RECIPIENT_INTERFACE: 0x01,
  LIBUSB_TRANSFER_TYPE_BULK: 0x02,
  mockMode: true
};
