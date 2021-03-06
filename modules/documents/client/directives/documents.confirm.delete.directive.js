'use strict';
angular.module('documents')
  .directive('confirmDelete', ['ConfirmDeleteService', function (ConfirmDeleteService) {
    // x-confirm-delete
    return {
      restrict: 'A',
      scope: {
        files: '=',
        folders: '=',
        project: '=',
        currentNode: '=',
        deleteCallback: '='
      },
      link: function (scope, element) {
        element.on('click', function () {
          ConfirmDeleteService.confirmDialog(scope);
        });
      }
    };
  }])
  .service('ConfirmDeleteService', ['$rootScope', '$uibModal', '_', '$timeout', 'DocumentMgrService', function ($rootScope, $uibModal, _, $timeout, DocumentMgrService) {
    var service = this;
    service.confirmDialog = function(scope) {
      return new Promise(function(fulfill, reject) {
        $uibModal.open({
          animation: true,
          templateUrl: 'modules/documents/client/views/partials/modal-document-confirm-delete.html',
          resolve: {},
          size: 'lg',
          controllerAs: 'confirmDlg',
          controller: function ($scope, $uibModalInstance) {
            var NO_AUTH = "Not authorized to delete";
            var HAS_CONTENT = "Folders must be empty before they can be deleted";
            var IS_PUBLISHED = "Content must be unpublished before it can be deleted";
            var self = this;
            /*
						Set the following to true, during development, if you want to test the server side delete API.
						This will bypass the client side tests and send all selected files or folders.
						This is also a good way to test the client side error handling.
					 */
            self.testServerAPI = false;

            self.busy = true;
            self.deleteCallback = scope.deleteCallback;
            self.currentNode = scope.currentNode;
            self.project = scope.project;
            self.submit = submit;
            self.cancel = cancel;

            // Initialize ....
            init();

            function init() {
              self.files = collect(scope.files);
              self.folders = collect(scope.folders);
              // the combined list is used by the ng-repeat
              self.combinedList = self.folders.concat(self.files);
              self.deletableFolders = _.filter(self.folders, function (item) {
                return item.canBeDeleted;
              });
              self.deletableFiles = _.filter(self.files, function (item) {
                return item.canBeDeleted;
              });
              checkFoldersForContent()
                .then (function () {
                  // repeat filter on folders
                  self.deletableFolders = _.filter(self.folders, function (item) {
                    return item.canBeDeleted;
                  });
                  updateText();
                  self.busy = false;
                  $scope.$apply();
                }).catch(function (err) {
                  self.busy = false;
                  self.errMsg = err.message;
                  $scope.$apply();
                  return reject(err);
                });
            }

            // collect deletable folders and files
            function collect(items) {
              if (!items ) {
                return [];
              }
              // service may be invoked on a single folder or file ....
              items = Array.isArray(items) ? items : [ items ];
              var results = _.map(items, function(item) {
                var fClone = _.clone(item /* shallow clone */);
                if (fClone.type === 'File') {
                  // file clone has f.isPublished and f.displayName
                  fClone.userCanDelete = item.userCan.delete;
                  fClone.type = ['png','jpg','jpeg'].indexOf(fClone.internalExt) > -1 ? 'Picture' : 'File';
                } else {
                  fClone.userCanDelete = self.project.userCan.manageFolders;
                  fClone.type = 'Folder';
                  fClone.displayName = item.model.name;
                  fClone.isPublished = item.model.published;
                }
                fClone.canBeDeleted = fClone.userCanDelete && !fClone.isPublished;
                return fClone;
              });
              return results;
            }

            function checkFoldersForContent() {
              var promises = [];
              //We check all folders (instead of just deletable folders) since a folder can be published and can have children
              //In that case, we need to display two warnings
              _.forEach(self.folders, function(fldr) {
                // Does the folder have child folders? ....
                var node = self.currentNode.first(function (child) {
                  return (child.model.id === fldr.model.id);
                });
                //Does the folder have document content?....
                promises.push(new Promise (function (resolve, reject) {
                  DocumentMgrService.getDirectoryDocuments(self.project, fldr.model.id)
                    .then(function (result) {
                      //A folder could have child folders (nodes) or could have files (end nodes)
                      fldr.hasChildren = node.hasChildren() || result.data.length > 0;
                      // If a folder has children or has been published, it cannot be deleted.
                      fldr.canBeDeleted = !(fldr.hasChildren || fldr.isPublished);
                      return resolve(fldr);
                    })
                    .catch(function (err) {
                      return reject(err);
                    });
                }));
              });
              if (promises.length === 0) {
                // Folders have no content or content is only folders
                return Promise.resolve();
              }
              // else some folders might have document content run all promises in array
              return Promise.all(promises);
            }

            function updateText() {
              var folderCnt = self.folders.length;
              var fileCnt = self.files.length;
              var deletableFolderCnt = self.deletableFolders.length;
              var deletableFileCnt = self.deletableFiles.length;
              var CONFIRM_DELETE = "Delete Files and/or Folders";
              var CANNOT_DELETE = "Delete Files and/or Folders";
              var INFO_DELETE = "One or more of the following files or folders cannot be deleted.";
              self.allBlocked = false;
              self.hasBlockedContent = false;

              if (deletableFolderCnt > 0 || deletableFileCnt > 0) {
                self.title = CONFIRM_DELETE;
                self.confirmText = "Are you sure you want to <strong>PERMANENTLY</strong> delete the following file(s) and/or folder(s)? This action <strong>CANNOT</strong> be undone.";
                if (folderCnt > deletableFolderCnt || fileCnt > deletableFileCnt ) {
                  self.hasBlockedContent = true;
                  self.bannerText = INFO_DELETE;
                  self.title = CONFIRM_DELETE;
                  // self.confirmText      += "Are you sure you want to delete the following file(s) and/or folder(s)? This action cannot be undone.";
                }
                self.showSubmit = true;
                self.cancelText = 'Cancel';
              } else {
                // No files and no folders can be deleted
                self.allBlocked = true;
                if (self.testServerAPI) {
                  self.title = "Confirm Delete API Testing";
                  self.showSubmit = true;
                  self.cancelText = 'cancel';

                } else {
                  self.title = CANNOT_DELETE;
                  self.showSubmit = false;
                  self.cancelText = 'OK';
                  self.hasBlockedContent = true;
                  self.bannerText = INFO_DELETE;
                }
              }
              // update the text why a user can not delete an item...
              _.forEach(self.folders, function (item) {
                setReasonForItem(item);
              });
              _.forEach(self.files, function (item) {
                setReasonForItem(item);
              });
            }

            function setReasonForItem(item) {
              if (!item.canBeDeleted) {
                item.reason = (
                  !item.userCanDelete ? NO_AUTH :
                    item.isPublished	? "<ul>" + "<li>" + (item.hasChildren ? HAS_CONTENT + "</li><li>" + IS_PUBLISHED : IS_PUBLISHED) + "</li></ul>" :
                      item.hasChildren	? "<ul>" + "<li>" + HAS_CONTENT : "" + "</li></ul>"
                );
              }
            }

            function cancel() {
              $uibModalInstance.dismiss('cancel');
            }

            function submit () {
              self.busy = true;
              var folders = self.testServerAPI ? self.folders : self.deletableFolders;
              var files = self.testServerAPI ? self.files : self.deletableFiles;
              self.deleteCallback(folders,files)
                .then(function (result) {
                  self.busy = false;
                  $uibModalInstance.close(result);
                }, function (err) {
                  self.busy = false;
                  self.errMsg = err.message;
                  $scope.$apply();
                });
            }
          }
        });
      });
    };
  }]);
