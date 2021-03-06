'use strict';

/**
 * Module dependencies.
 */
var mongoose = require('mongoose'),
	errorHandler = require('./errors.server.controller'),
	Form = mongoose.model('Form'),
	FormSubmission = mongoose.model('FormSubmission'),
	config = require('../../config/config'),
	diff = require('deep-diff'),
	_ = require('lodash'),
	nodemailer = require('nodemailer'),
	emailNotifications = require('../libs/send-email-notifications'),
	constants = require('../libs/constants'),
	helpers = require('./helpers.server.controller'),
	async = require('async');

var smtpTransport = nodemailer.createTransport(config.mailer.options);

/**
 * Delete a forms submissions
 */
exports.deleteSubmissions = function(req, res) {

	var submission_id_list = req.body.deleted_submissions;

	FormSubmission.remove({ form: req.form, _id: {$in: submission_id_list} }, function(err){

		if(err){
			res.status(400).send({
				message: errorHandler.getErrorMessage(err)
			});
			return;
		}

		res.status(200).send('Form submissions successfully deleted');
	});
};

/**
 * Submit a form entry
 */
exports.createSubmission = function(req, res) {

	var timeElapsed = 0;

	if(typeof req.body.timeElapsed === 'number'){
		timeElapsed = req.body.timeElapsed;
	}
	var submission = new FormSubmission({
		form: req.body._id,
		form_fields: req.body.form_fields,
		timeElapsed: timeElapsed,
		percentageComplete: req.body.percentageComplete,
		ipAddr: req.body.ipAddr,
		geoLocation: req.body.geoLocation,
		device: req.body.device
	});

	submission.save(function(err, submission){
		if (err) {
			console.error(err.message);
			return res.status(500).send({
				message: errorHandler.getErrorMessage(err)
			});
		}
		var form = req.body;
		var formFieldDict = emailNotifications.createFieldDict(form.form_fields);

		async.waterfall([
		    function(callback) {
		    	if (form.selfNotifications && form.selfNotifications.enabled) {
		    		if(form.selfNotifications.fromField){
		    			form.selfNotifications.fromEmails = formFieldDict[form.selfNotifications.fromField];
		    		} else {
		    			form.selfNotifications.fromEmails = config.mailer.options.from;
		    		}

					emailNotifications.send(form.selfNotifications, formFieldDict, smtpTransport, function(err){
						if(err){
							return callback({
								message: 'Failure sending submission self-notification email'
							});
						}

						callback();
					});
				} else {
					callback();
				}
		    },
		    function(callback) {
		        if (form.respondentNotifications && form.respondentNotifications.enabled && form.respondentNotifications.toField) {

					form.respondentNotifications.toEmails = formFieldDict[form.respondentNotifications.toField];
					emailNotifications.send(form.respondentNotifications, formFieldDict, smtpTransport, function(err){
						if(err){
							return callback({
								message: 'Failure sending submission respondent-notification email'
							});
						}

						callback();
					});
				} else {
					callback();
				}
		    }
		], function (err) {
			if(err){
				return res.status(400).send(err);
			}
		    res.status(200).send('Form submission successfully saved');
		});
	});
};

/**
 * Get List of Submissions for a given Form
 */
exports.listSubmissions = function(req, res) {
	FormSubmission.find({ form: req.form._id }).sort('created').lean().exec(function(err, _submissions) {
		if (err) {
			console.error(err);
			return res.status(500).send({
				message: errorHandler.getErrorMessage(err)
			});
		}
		res.json(_submissions);
	});
};

/**
 * Get Visitor Analytics Data for a given Form
 */
exports.getVisitorData = function(req, res) {
  var results = [];

	Form.aggregate([
	    {
	        $match: {
	            _id: mongoose.Types.ObjectId(req.form.id),
	            admin: mongoose.Types.ObjectId(req.user.id)
	        }
	    },
	    {
	        $facet: {
	            'deviceStatistics': [
	                {
	                    $unwind: '$analytics.visitors'
	                },
	                {
	                    $project: {
	                        _id: 0,
	                        deviceType: '$analytics.visitors.deviceType',
	                        SubmittedTimeElapsed: {
	                            $cond: [
	                                {
	                                    $eq: ['$analytics.visitors.isSubmitted', true]
	                                },
	                                '$analytics.visitors.timeElapsed',
	                                0
	                            ]
	                        },
	                        SubmittedResponses: {
	                            $cond: [
	                                {
	                                    $eq: ['$analytics.visitors.isSubmitted', true]
	                                },
	                                1,
	                                0
	                            ]
	                        }
	                    }
	                },
	                {
	                    $group: {
	                        _id: '$deviceType',
	                        total_time: { $sum: '$SubmittedTimeElapsed'  },
	                        responses: { $sum: '$SubmittedResponses' },
	                        visits: { $sum: 1 }
	                    }
	                },
	                {
	                    $project: {
	                        total_time: '$total_time',
	                        responses: '$responses',
	                        visits: '$visits',
	                        average_time: {
	                        	$cond: [
                    				{ $eq: [ '$responses', 0 ] },
                    				0,
                    				{ $divide: ['$total_time', '$responses'] }
                    			]
	                        },
	                        conversion_rate: {
	                            $multiply: [
	                            	100,
	                            	{
                            			$cond: [
                            				{ $eq: [ '$visits', 0 ] },
                            				0,
                            				{ $divide: ['$responses', '$visits'] }
                            			]
	                            	}
	                            ]
	                        }
	                    }
	                }
	            ],
	            'globalStatistics': [
	                {
	                    $unwind: '$analytics.visitors'
	                },
	                {
	                    $project: {
	                        _id: 0,
	                        deviceType: '$analytics.visitors.deviceType',
	                        SubmittedTimeElapsed: {
	                            $cond: [
	                                {
	                                    $eq: ['$analytics.visitors.isSubmitted', true]
	                                },
	                                '$analytics.visitors.timeElapsed',
	                                0
	                            ]
	                        },
	                        SubmittedResponses: {
	                            $cond: [
	                                {
	                                    $eq: ['$analytics.visitors.isSubmitted', true]
	                                },
	                                1,
	                                0
	                            ]
	                        }
	                    }
	                },
	                {
	                    $group: {
	                        _id: null,
	                        total_time: { $sum: '$SubmittedTimeElapsed'  },
	                        responses: { $sum: '$SubmittedResponses' },
	                        visits: { $sum: 1 }
	                    }
	                },
	                {
	                    $project: {
	                        _id: 0,
	                        total_time: '$total_time',
	                        responses: '$responses',
	                        visits: '$visits',
	                        average_time: {
	                            $cond: [
                    				{ $eq: [ '$responses', 0 ] },
                    				0,
                    				{ $divide: ['$total_time', '$responses'] }
                    			]
	                        },
	                        conversion_rate: {
	                            $multiply: [
	                            	100,
	                            	{
	                            		$cond: [
                            				{ $eq: [ '$visits', 0 ] },
                            				0,
                            				{ $divide: ['$responses', '$visits'] }
                            			]
	                            	}
	                            ]
	                        }
	                    }
	                }
	            ],
	        }
	    }
	])
    .cursor()
    .exec()
    .on('end', function() {
      res.json(results);
    })
    .on('data', function(entry){
      results.push(entry);
	  });
};

/**
 * Create a new form
 */
exports.create = function(req, res) {
	if(!req.body.form){
		return res.status(400).send({
			message: 'Invalid Input'
		});
	}
	var form = new Form(req.body.form);
	form.admin = req.user._id;

	form.save(function(err, createdForm) {
		if (err) {
			return res.status(500).send({
				message: errorHandler.getErrorMessage(err)
			});
		}

		createdForm = helpers.removeSensitiveModelData('private_form', createdForm.toJSON());
		return res.json(createdForm);
	});
};

/**
 * Show the current form
 */
exports.read = function(req, res) {
	if(!req.user || (req.form.admin.id !== req.user.id) ){
		readForRender(req, res);
	} else {
			if(!req.form){
				return res.status(404).send({
					message: 'Form Does Not Exist'
				});
			}

			var newForm = helpers.removeSensitiveModelData('private_form', req.form.toJSON());

			return res.json(newForm);
	}
};

/**
 * Show the current form for rendering form live
 */
var readForRender = exports.readForRender = function(req, res) {
	var newForm = req.form;
	if (!newForm.isLive && !req.user) {
		return res.status(401).send({
			message: 'Form is Not Public'
		});
	}

	newForm = helpers.removeSensitiveModelData('public_form', newForm);

	if(newForm.startPage && !newForm.startPage.showStart){
		delete newForm.startPage;
	}

	return res.json(newForm);
};

/**
 * Update a form
 */
exports.update = function(req, res) {
    var form = req.form;
    var updatedForm = req.body.form;

    if(!form.analytics){
    	form.analytics = {
    		visitors: [],
    		gaCode: ''
    	};
    }

	if (req.body.changes) {
		var formChanges = req.body.changes;

		formChanges.forEach(function (change) {
			diff.applyChange(form._doc, true, change);
		});
	} else {
		if(!updatedForm){
			return res.status(400).send({
				message: 'Updated Form is empty'
			});
		}

		delete updatedForm.lastModified;
	    delete updatedForm.created;
	    delete updatedForm.id;
	    delete updatedForm._id;
	    delete updatedForm.__v;

		//Unless we have 'admin' privileges, updating the form's admin is disabled
		if(updatedForm && req.user.roles.indexOf('admin') === -1) {
			delete updatedForm.admin;
		}

		//Do this so we can create duplicate fields
		var checkForValidId = new RegExp('^[0-9a-fA-F]{24}$');
		for(var i=0; i < req.body.form.form_fields.length; i++){
			var field = req.body.form.form_fields[i];
			if(!checkForValidId.exec(field._id+'')){
				delete field._id;
			}
		}
		form = _.extend(form, updatedForm);
	}

	form.save(function(err, savedForm) {
		if (err) {
            res.status(500).send({
				message: errorHandler.getErrorMessage(err)
			});
		} else {
			savedForm = helpers.removeSensitiveModelData('private_form', savedForm.toJSON());
			res.json(savedForm);
		}
	});
};

/**
 * Delete a form
 */
exports.delete = function(req, res) {
	var form = req.form;
	Form.remove({_id: form._id}, function(err) {
		if (err) {
			res.status(400).send({
				message: errorHandler.getErrorMessage(err)
			});
		} else {
			res.json(
        helpers.removeSensitiveModelData('private_form', form)
      );
		}
	});
};

/**
 * Get All of Users' Forms
 */
exports.list = function(req, res) {
	//Allow 'admin' user to view all forms
	var searchObj = {admin: req.user};
	if(req.user.isAdmin()) searchObj = {};

	Form.find(searchObj)
		.sort('-created')
		.select('title language isLive')
		.lean()
		.exec(function(err, forms) {
		if (err) {
			return res.status(400).send({
				message: errorHandler.getErrorMessage(err)
			});
		}

		var form_ids = forms.map(function(form){
			return form._id;
		});

		//Get number of submissions for each form
		FormSubmission
      .aggregate()
      .match({
        form: {
          $in: form_ids
        }
      })
      .group({
        _id: '$form',
        responses: { $sum: 1 }
      })
      .cursor()
      .exec()
      .on('end', function() {
        forms = forms.map(function (form) {
          if (!form.submissionNum) {
            form.submissionNum = 0;
          }

          return helpers.removeSensitiveModelData('private_form', form);
        });

        res.json(forms);
      })
      .on('data', function(result){
        forms = forms.map(function (form) {
          if (_.isEqual(form._id, result._id)) {
            form.submissionNum = result.responses;
          }

          return form;
        });
		  });
	});
};
/**
 * Form middleware
 */

exports.formByTitle = function(req, res, next, id) {

	var val=(id+"").replace("-"," ");
	Form.findOne({title:{$regex : new RegExp(val, "i")}})
		.select('admin title language form_fields startPage endPage showFooter isLive design analytics.gaCode respondentNotifications selfNotifications')
		.populate('admin')
		.exec(function(err, form) {
		if (err) {
			return next(err);
		} else if (!form || form === null) {
			res.status(404).send({
				message: 'Form not found'
			});
		}
		else {
			req.form = form;
			return next();
		}
	});
};

exports.formByID = function(req, res, next, id) {
	if (!mongoose.Types.ObjectId.isValid(id)) {
		return res.status(400).send({
			message: 'Form is invalid'
		});
	}

	Form.findById(id)
		.select('admin title language form_fields startPage endPage showFooter isLive design analytics.gaCode respondentNotifications selfNotifications')
		.populate('admin')
		.exec(function(err, form) {
		if (err) {
			return next(err);
		} else if (!form || form === null) {
			res.status(404).send({
				message: 'Form not found'
			});
		}
		else {
			req.form = form;
			return next();
		}
	});
};

/**
 * FastForm middleware
 */
exports.formByIDFast = function(req, res, next, id) {
	if (!mongoose.Types.ObjectId.isValid(id)) {
		return res.status(400).send({
			message: 'Form is invalid'
		});
	}
	Form.findById(id)
		.lean()
		.select('title language form_fields startPage endPage showFooter isLive design analytics.gaCode selfNotifications respondentNotifications')
		.exec(function(err, form) {
		if (err) {
			return next(err);
		} else if (!form || form === null) {
			res.status(404).send({
				message: 'Form not found'
			});
		}
		else {
			//Remove sensitive information from User object
			req.form = form;
			return next();
		}
	});
};

/**
 * Form authorization middleware
 *
 * reject access if the owner of the form is not the current user and the user is not an admin
 */
exports.hasAuthorization = function(req, res, next) {
	var form = req.form;
	if (!req.form.admin || req.form.admin.id !== req.user.id && req.user.roles.indexOf('admin') < 0) {
		return res.status(403).send({
			message: 'User '+req.user.username+' is not authorized to edit Form: '+form.title
		});
	}
	return next();
};
