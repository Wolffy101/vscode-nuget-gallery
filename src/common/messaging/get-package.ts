type GetPackageRequest = {
  Url: string;
  Id: string;
  OtherUrls?: Array<string>;
};

type GetPackageResponse = {
  IsFailure: boolean;
  Package?: Package;
  Error?: HttpError;
};
